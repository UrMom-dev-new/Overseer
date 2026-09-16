import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearSnapshotCacheForTests,
  coalesce,
  writeSnapshot,
  readSnapshot,
  isSnapshotUsable,
  collectionStatus,
  pointGeometry,
  sourceIdentity,
  updateSourceStatuses,
  readSourceStatuses,
} from '../src/lib/feed-integrity';
import { normalizeGdeltGeoJson } from '../src/lib/feed-integrity/gdelt';
import { keywordRelevance, looksLikeRssOrAtom, normalizeNewsItem, parseRSSItems } from '../src/lib/feed-integrity/news';
import { resolveTextLocation } from '../src/lib/feed-integrity/location';
import { normalizeEonetVolcanoes } from '../src/lib/feed-integrity/fires';
import { normalizeKevCatalog } from '../src/lib/feed-integrity/cyber';
import { normalizeNwsAlerts } from '../src/lib/feed-integrity/weather';

const collectedAt = '2026-09-12T12:00:00.000Z';

function withSnapshotDataDir(run: (dir: string) => void): void {
  const previousDir = process.env.OVERSEER_DATA_DIR;
  const previousMode = process.env.OVERSEER_DATA_MODE;
  const previousCache = process.env.OVERSEER_SNAPSHOT_CACHE;
  const dir = mkdtempSync(join(tmpdir(), 'overseer-snapshots-'));
  process.env.OVERSEER_DATA_DIR = dir;
  delete process.env.OVERSEER_DATA_MODE;
  delete process.env.OVERSEER_SNAPSHOT_CACHE;
  try {
    clearSnapshotCacheForTests();
    run(dir);
  } finally {
    clearSnapshotCacheForTests();
    if (previousDir === undefined) delete process.env.OVERSEER_DATA_DIR;
    else process.env.OVERSEER_DATA_DIR = previousDir;
    if (previousMode === undefined) delete process.env.OVERSEER_DATA_MODE;
    else process.env.OVERSEER_DATA_MODE = previousMode;
    if (previousCache === undefined) delete process.env.OVERSEER_SNAPSHOT_CACHE;
    else process.env.OVERSEER_SNAPSHOT_CACHE = previousCache;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('GDELT valid empty response returns successful empty records without synthetic incidents', () => {
  const result = normalizeGdeltGeoJson({ type: 'FeatureCollection', features: [] }, 'conflict', 'https://gdelt.test', collectedAt);
  assert.ok(result);
  assert.equal(result.records.length, 0);
  assert.equal(result.received, 0);
});

test('GDELT malformed payload is not classified as successful empty', () => {
  const result = normalizeGdeltGeoJson({ ok: true }, 'conflict', 'https://gdelt.test', collectedAt);
  assert.equal(result, null);
});

test('GDELT keeps mentions as reports with mentioned-location semantics and stable IDs', () => {
  const payload = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [30.523, 50.45] },
        properties: { name: 'Report from Kyiv', url: 'https://example.com/a', count: 4, shareimage: 'https://example.com/img.jpg' },
      },
    ],
  };
  const first = normalizeGdeltGeoJson(payload, 'conflict', 'https://gdelt.test', collectedAt);
  const second = normalizeGdeltGeoJson(payload, 'conflict', 'https://gdelt.test', '2026-09-12T12:05:00.000Z');
  assert.ok(first && second);
  assert.equal(first.records[0].type, 'geolocated_news_mentions');
  assert.equal(first.records[0].evidence_kind, 'report');
  assert.equal(first.records[0].location_relationship, 'mentioned_location');
  assert.equal(first.records[0].id, second.records[0].id);
  assert.equal(first.records[0].url, 'https://example.com/a');
});

test('last-known-good cache preserves last success metadata and does not overwrite on failures', () => {
  const status = collectionStatus({
    source: sourceIdentity('gdelt-geo:test', 'GDELT test', 'https://gdelt.test'),
    availability: 'ok',
    dataState: 'present',
    freshness: 'fresh',
    lastAttemptAt: collectedAt,
    lastSuccessfulFetchAt: collectedAt,
    acceptedRecords: 1,
  });
  writeSnapshot({ key: 'test-cache-key', records: [{ id: 'record-1' }], status, storedAtMs: Date.now() });
  const cached = readSnapshot<{ id: string }>('test-cache-key');
  assert.ok(isSnapshotUsable(cached, 60_000));
  assert.equal(cached.status.lastSuccessfulFetchAt, collectedAt);
  assert.equal(cached.records[0].id, 'record-1');
});

test('successful empty snapshot replaces previous records for the same cache key', () => {
  const key = 'test-cache-empty-replaces-present';
  const source = sourceIdentity('gdelt-geo:empty', 'GDELT test', 'https://gdelt.test');
  const presentStatus = collectionStatus({
    source,
    availability: 'ok',
    dataState: 'present',
    freshness: 'fresh',
    lastAttemptAt: collectedAt,
    lastSuccessfulFetchAt: collectedAt,
    acceptedRecords: 1,
  });
  writeSnapshot({ key, records: [{ id: 'old-record' }], status: presentStatus, storedAtMs: Date.now() });

  const emptyAt = '2026-09-12T12:05:00.000Z';
  const emptyStatus = collectionStatus({
    source,
    availability: 'ok',
    dataState: 'empty',
    freshness: 'fresh',
    lastAttemptAt: emptyAt,
    lastSuccessfulFetchAt: emptyAt,
    acceptedRecords: 0,
  });
  writeSnapshot({ key, records: [], status: emptyStatus, storedAtMs: Date.now() });

  const cached = readSnapshot<{ id: string }>(key);
  assert.ok(cached);
  assert.equal(cached.records.length, 0);
  assert.equal(cached.status.dataState, 'empty');
  assert.equal(cached.status.lastSuccessfulFetchAt, emptyAt);
});

test('expired snapshots are not silently eligible as current data', () => {
  const staleKey = 'test-cache-expired';
  const status = collectionStatus({
    source: sourceIdentity('gdelt-geo:stale', 'GDELT test', 'https://gdelt.test'),
    availability: 'ok',
    dataState: 'present',
    freshness: 'fresh',
    lastSuccessfulFetchAt: collectedAt,
    acceptedRecords: 1,
  });
  writeSnapshot({ key: staleKey, records: [{ id: 'old-record' }], status, storedAtMs: Date.now() - 120_000 });
  assert.equal(isSnapshotUsable(readSnapshot(staleKey), 60_000), false);
});

test('cache is bounded and request coalescing shares in-flight collection work', async () => {
  const source = sourceIdentity('cache-bound-test', 'Cache bound test', null);
  const status = collectionStatus({ source, availability: 'ok', dataState: 'present', freshness: 'fresh' });
  for (let i = 0; i < 85; i++) {
    writeSnapshot({ key: `bounded-cache-${i}`, records: [{ id: `${i}` }], status, storedAtMs: Date.now() });
  }
  assert.equal(readSnapshot('bounded-cache-0'), null);
  assert.ok(readSnapshot('bounded-cache-84'));

  let runs = 0;
  const run = () => coalesce('test-coalesced-request', async () => {
    runs++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true };
  });
  const [first, second] = await Promise.all([run(), run()]);
  assert.equal(runs, 1);
  assert.deepEqual(first, second);
});

test('persistent snapshots restore eligible cached data after memory is cleared', () => {
  withSnapshotDataDir((dir) => {
    const key = 'news:combined:v1';
    const status = collectionStatus({
      source: sourceIdentity('news:rss:example', 'Example RSS', 'https://example.test/feed.xml'),
      availability: 'ok',
      dataState: 'present',
      freshness: 'fresh',
      lastAttemptAt: collectedAt,
      lastSuccessfulFetchAt: collectedAt,
      acceptedRecords: 1,
    });
    writeSnapshot({ key, records: [{ id: 'rss-record', published: '2026-09-12T11:55:00.000Z' }], status, storedAtMs: Date.now() });
    clearSnapshotCacheForTests();

    const restored = readSnapshot<{ id: string; published: string }>(key);
    assert.ok(restored);
    assert.equal(restored.records[0].id, 'rss-record');
    assert.equal(restored.status.servingLastKnownGood, false);
    assert.equal(restored.status.lastSuccessfulFetchAt, collectedAt);

    const files = readdirSync(join(dir, 'snapshots'));
    assert.equal(files.length, 1);
    const persisted = readFileSync(join(dir, 'snapshots', files[0]), 'utf8');
    assert.equal(persisted.includes(key), false);
  });
});

test('persistent snapshots keep real and demo namespaces isolated', () => {
  withSnapshotDataDir(() => {
    const key = 'gdelt:query:conflict';
    const status = collectionStatus({
      source: sourceIdentity('gdelt-geo:conflict', 'GDELT', 'https://gdelt.test'),
      availability: 'ok',
      dataState: 'present',
      freshness: 'fresh',
      acceptedRecords: 1,
    });
    writeSnapshot({ key, records: [{ id: 'real-record' }], status, storedAtMs: Date.now() });
    clearSnapshotCacheForTests();

    process.env.OVERSEER_DATA_MODE = 'demo';
    assert.equal(readSnapshot(key), null);

    process.env.OVERSEER_DATA_MODE = 'real';
    assert.equal(readSnapshot<{ id: string }>(key)?.records[0].id, 'real-record');
  });
});

test('corrupt persistent snapshots recover as cache misses', () => {
  withSnapshotDataDir((dir) => {
    const key = 'news:combined:v1';
    const status = collectionStatus({
      source: sourceIdentity('news:rss:example', 'Example RSS', 'https://example.test/feed.xml'),
      availability: 'ok',
      dataState: 'present',
      freshness: 'fresh',
    });
    writeSnapshot({ key, records: [{ id: 'record' }], status, storedAtMs: Date.now() });
    const snapshotDir = join(dir, 'snapshots');
    const file = join(snapshotDir, readdirSync(snapshotDir)[0]);
    writeFileSync(file, '{broken json', 'utf8');
    clearSnapshotCacheForTests();

    assert.equal(readSnapshot(key), null);
    assert.equal(existsSync(file), false);
  });
});

test('scanner and user-query snapshots remain memory-only by default', () => {
  withSnapshotDataDir((dir) => {
    const status = collectionStatus({
      source: sourceIdentity('scanner', 'Scanner', null),
      availability: 'ok',
      dataState: 'present',
      freshness: 'fresh',
    });
    writeSnapshot({ key: 'scanner:user-query:example', records: [{ id: 'scan-result' }], status, storedAtMs: Date.now() });
    assert.ok(readSnapshot('scanner:user-query:example'));
    clearSnapshotCacheForTests();
    assert.equal(readSnapshot('scanner:user-query:example'), null);
    assert.equal(existsSync(join(dir, 'snapshots')), false);
  });
});

test('per-source statuses preserve independent failures and successes', () => {
  const okStatus = collectionStatus({
    source: sourceIdentity('source-ok', 'Healthy source', null),
    availability: 'ok',
    dataState: 'present',
    freshness: 'fresh',
    acceptedRecords: 1,
  });
  const errorStatus = collectionStatus({
    source: sourceIdentity('source-error', 'Failed source', null),
    availability: 'error',
    dataState: 'unavailable',
    freshness: 'unknown',
    errorCode: 'TIMEOUT',
  });
  updateSourceStatuses([okStatus, errorStatus]);
  const statuses = readSourceStatuses();
  assert.equal(statuses.find((status) => status.source.providerId === 'source-ok')?.availability, 'ok');
  assert.equal(statuses.find((status) => status.source.providerId === 'source-error')?.availability, 'error');
});

test('keyword relevance is word-aware and not fabricated AI analysis', () => {
  assert.equal(keywordRelevance('software release').matchedTerms.includes('war'), false);
  const item = normalizeNewsItem({
    title: 'Missile strike reported in Kyiv, Ukraine',
    description: 'Source report says military activity occurred in Kyiv.',
    link: 'https://example.com/news',
    pubDate: null,
    source: 'Example RSS',
  }, collectedAt);
  assert.equal(item.machine_assessment, null);
  assert.equal(item.published, null);
  assert.equal(item.publication_time_quality, 'invalid_or_missing');
  assert.equal(item.location_precision, 'city');
  assert.equal(item.location_relationship, 'event_location');
  assert.equal(item.keyword_relevance.method, 'word_aware_keyword_relevance');
});

test('missing news publication time remains null and ID-stable across refreshes', () => {
  const article = {
    title: 'Military activity reported near Kyiv',
    description: 'A source report discusses Kyiv without a machine assessment.',
    link: 'https://example.com/stable-news',
    pubDate: null,
    source: 'Example RSS',
  };
  const first = normalizeNewsItem(article, collectedAt);
  const second = normalizeNewsItem(article, '2026-09-12T12:05:00.000Z');
  assert.equal(first.id, second.id);
  assert.equal(first.published, null);
  assert.equal(second.published, null);
  assert.equal(second.integrity.timing.publishedAt, null);
});

test('RSS parser handles CDATA, Atom entries, encoded text, links, and timestamps', async () => {
  const rssItems = await parseRSSItems(`<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[Missile alert update]]></title>
          <link>https://example.com/rss-item</link>
          <pubDate>Sat, 12 Sep 2026 12:00:00 GMT</pubDate>
          <description><![CDATA[<p>Source report with <strong>markup</strong>.</p>]]></description>
        </item>
      </channel>
    </rss>`, 'Example RSS');
  assert.equal(rssItems.length, 1);
  assert.equal(rssItems[0].title, 'Missile alert update');
  assert.equal(rssItems[0].description, 'Source report with markup.');
  assert.equal(rssItems[0].link, 'https://example.com/rss-item');
  assert.equal(rssItems[0].pubDate, '2026-09-12T12:00:00.000Z');

  const atomItems = await parseRSSItems(`<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom report</title>
        <link href="https://example.com/atom-item" />
        <updated>2026-09-12T13:00:00Z</updated>
        <summary>Atom summary</summary>
      </entry>
    </feed>`, 'Example Atom');
  assert.equal(atomItems.length, 1);
  assert.equal(atomItems[0].title, 'Atom report');
  assert.equal(atomItems[0].link, 'https://example.com/atom-item');
});

test('login or blocking HTML is not classified as a healthy RSS empty feed', () => {
  assert.equal(looksLikeRssOrAtom('<html><title>Login required</title></html>'), false);
  assert.equal(looksLikeRssOrAtom('<rss><channel></channel></rss>'), true);
});

test('location resolver prefers Kyiv city over Ukraine country and rejects ambiguity', () => {
  const kyiv = resolveTextLocation('Explosion reported in Kyiv, Ukraine.');
  assert.deepEqual(kyiv.coords, [50.45, 30.523]);
  assert.equal(kyiv.precision, 'city');

  const ambiguous = resolveTextLocation('Talks across Moscow and Kyiv continued.');
  assert.equal(ambiguous.coords, null);
  assert.ok(ambiguous.qualityFlags.includes('ambiguous_location'));
});

test('valid zero coordinates are accepted while invalid coordinates are rejected', () => {
  assert.deepEqual(pointGeometry(0, 0), { type: 'Point', coordinates: [0, 0] });
  assert.equal(pointGeometry(Number.NaN, 0), null);
  assert.equal(pointGeometry(181, 0), null);
  assert.equal(pointGeometry(0, -91), null);
});

test('EONET volcano records retain null unsupported measurements', () => {
  const result = normalizeEonetVolcanoes({
    events: [
      {
        id: 'EONET_1',
        title: 'Volcano activity',
        geometry: [{ type: 'Point', coordinates: [10, 20], date: '2026-09-12T00:00:00Z' }],
        sources: [{ url: 'https://eonet.example/event' }],
      },
    ],
  }, 'https://eonet.test', collectedAt);
  assert.ok(result);
  assert.equal(result.records[0].brightness, null);
  assert.equal(result.records[0].frp, null);
  assert.equal(result.records[0].confidence, null);
  assert.equal(result.records[0].type, 'volcano_report');
});

test('CISA KEV records do not manufacture technical severity', () => {
  const result = normalizeKevCatalog({
    vulnerabilities: [
      {
        cveID: 'CVE-2026-0001',
        vulnerabilityName: 'Example vuln',
        vendorProject: 'Example',
        product: 'Product',
        dateAdded: '2026-09-10',
        dueDate: '2026-10-01',
      },
    ],
  }, 'https://cisa.test', collectedAt, 30);
  assert.ok(result);
  assert.equal(result.records[0].severity, null);
  assert.equal(result.records[0].technical_severity, null);
  assert.equal(result.records[0].known_exploited, true);
});

test('NWS polygons are preserved and geometry-free alerts remain records', () => {
  const result = normalizeNwsAlerts({
    features: [
      {
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: { id: 'alert-1', event: 'Flood Warning', severity: 'Severe', effective: '2026-09-12T00:00:00Z', areaDesc: 'Test Area' },
      },
      {
        geometry: null,
        properties: { id: 'alert-2', event: 'Special Weather Statement', areaDesc: 'Area only' },
      },
    ],
  }, 'https://weather.test', collectedAt);
  assert.ok(result);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].geometry?.type, 'Polygon');
  assert.equal(result.records[0].geometry_label, 'Source warning area; representative point is approximate');
  assert.equal(result.records[1].lat, null);
  assert.equal(result.records[1].geometry_label, 'Area specified; geometry unavailable');
});

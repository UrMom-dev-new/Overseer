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
import { buildOuiLookupResult, lookupOuiRecord, normalizeMacInput, parseOuiCsv } from '../src/lib/feed-integrity/oui';
import { normalizeSurveillanceCapabilities, parseCsv } from '../src/lib/feed-integrity/surveillance-capabilities';
import { normalizeSurveillanceIndustry, parseSurveillanceIndustryIndex } from '../src/lib/feed-integrity/surveillance-industry';
import { normalizeOdintCyberRecon } from '../src/lib/feed-integrity/odint';
import { normalizeFedRolodex } from '../src/lib/feed-integrity/fed';
import { normalizeGlobalDataCenters } from '../src/lib/feed-integrity/data-centers';

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

test('surveillance capability CSV parser handles quoted commas and escaped quotes', () => {
  const rows = parseCsv('name,description\n"Acme, Inc.","Uses ""quoted"" fields"\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Acme, Inc.');
  assert.equal(rows[0].description, 'Uses "quoted" fields');
});

test('surveillance capabilities normalize source records without synthetic city jitter', () => {
  const atlasCsv = [
    '"AOSNUMBER","NEWAOSNUMBER (ORI9)","City","County","State","Agency","Type of LEA","Summary","Type of Juris","Technology","TECH ABV","Vendor","Link 1","Link 1 Snapshot","Link 1 Source","Link 1 Type","Link 1 Date"',
    '"AOS000001","VA0850300BWC","Woodstock","Shenandoah County","VA","Woodstock Police Department","Police","The department uses body-worn cameras.","Municipal","Body-worn Cameras","","Axon","https://example.test/source","","Example Source","","12/27/2012"',
  ].join('\n');
  const transfersCsv = [
    'State,Station Name (LEA),NSN,Item Name,Quantity,UI,Acquisition Value,DEMIL Code,DEMIL IC,Ship Date,Cost',
    'AK,ALASKA DEPT OF PUBLIC SAFETY,5855-01-228-0936,NIGHT VISION GOGGLE,1,Each,4300,F,1,05/19/98,4300',
  ].join('\n');
  const flightPaths = JSON.stringify([
    {
      id: 'flight-1',
      agency: 'DHS',
      name: 'US DEPARTMENT OF HOMELAND SECURITY',
      n_number: '561A',
      path: [[33.8975, -119.18], [33.84731, -119.116]],
      point_count: 2,
      avg_altitude: 12000,
      avg_speed: 140,
    },
  ]);

  const result = normalizeSurveillanceCapabilities({
    atlasCsv,
    transfersCsv,
    cityCoordsJson: JSON.stringify({ 'WOODSTOCK,VA': [38.8818, -78.5058] }),
    flightPathsJson: flightPaths,
    collectedAt,
    maxRecords: 10,
    maxLocations: 10,
    maxFlights: 10,
  });

  assert.equal(result.counts.acceptedRecords, 2);
  const woodstock = result.locations.find((location) => location.city === 'Woodstock');
  assert.ok(woodstock);
  assert.equal(woodstock.location_precision, 'city');
  assert.equal(woodstock.lat, 38.8818);
  assert.equal(woodstock.lng, -78.5058);

  const statewide = result.locations.find((location) => location.state === 'AK');
  assert.ok(statewide);
  assert.equal(statewide.location_precision, 'region');
  assert.equal(statewide.city, 'Statewide / unspecified city');

  assert.equal(result.flightPaths.length, 1);
  assert.deepEqual(result.flightPaths[0].path[0], [-119.18, 33.8975]);
  assert.equal(result.flightPaths[0].evidence_kind, 'reference');
});

test('surveillance industry parser reads README dossier rows with representative precision', () => {
  const readme = [
    '| Dossier | Region | The Pitch |',
    '|:--------|:-------|:----------|',
    '| **[United States](./american-surveillance-tools.md)** | North America | Police & government surveillance tools |',
    '| **[Palantir](./palantir-deep-dive.md)** | US // Private Sector | Data integration platform |',
  ].join('\n');

  const index = parseSurveillanceIndustryIndex(readme);
  assert.equal(index.length, 2);
  assert.equal(index[0].id, 'american-surveillance-tools');
  assert.equal(index[0].label, 'United States');
  assert.equal(index[0].location_precision, 'country');
  assert.equal(index[1].label, 'Palantir');
  assert.equal(index[1].location_precision, 'city');
});

test('surveillance industry normalizer omits unavailable dossier files and keeps source links', () => {
  const readme = [
    '| Dossier | Region | The Pitch |',
    '|:--------|:-------|:----------|',
    '| **[United States](./american-surveillance-tools.md)** | North America | Police & government surveillance tools |',
    '| **[Canada](./canada-surveillance.md)** | North America | DPI exporters |',
  ].join('\n');
  const dossier = [
    '## License Plate Readers (ALPR)',
    '',
    '### Flock Safety ALPR / Nova',
    '`alpr` `mass-surveillance`',
    '',
    '**Company:** Flock Safety',
    '**Origin:** USA',
    '**Website:** <https://www.flocksafety.com/>',
    '',
    'Automated License Plate Readers scanning vehicles across communities with source-reported deployments.',
    '',
    '[EFF](https://www.eff.org)',
  ].join('\n');

  const result = normalizeSurveillanceIndustry({
    readmeMarkdown: readme,
    dossiers: {
      'american-surveillance-tools.md': dossier,
      'canada-surveillance.md': null,
    },
    collectedAt,
  });

  assert.equal(result.counts.indexedDossiers, 2);
  assert.equal(result.counts.acceptedDossiers, 1);
  assert.equal(result.counts.rejectedDossiers, 1);
  assert.equal(result.dossiers.length, 1);
  assert.equal(result.dossiers[0].evidence_kind, 'reference');
  assert.ok(result.dossiers[0].featured_entities.includes('Flock Safety'));
  assert.ok(result.dossiers[0].source_links.some((link) => link.url === 'https://www.flocksafety.com/'));
  assert.equal(result.locations[0].location_precision, 'country');
});

test('ODINT normalizer parses source domains without treating comments as observations', () => {
  const text = [
    '# United States Websites - Comprehensive List',
    '# Total: 350 domains',
    '',
    '# EXECUTIVE BRANCH (5)',
    'whitehouse.gov',
    'vice.president.gov',
    '',
    '# This comment should not become a target',
  ].join('\n');

  const result = normalizeOdintCyberRecon({
    files: [{ path: 'CYBER RECON TOUR/North America/us-websites.txt', text }],
    collectedAt,
  });

  assert.equal(result.counts.acceptedFiles, 1);
  assert.equal(result.counts.acceptedTargets, 2);
  assert.equal(result.targets[0].domain, 'whitehouse.gov');
  assert.equal(result.targets[0].country, 'United States');
  assert.equal(result.targets[0].region, 'North America');
  assert.equal(result.targets[0].section, 'EXECUTIVE BRANCH (5)');
  assert.equal(result.targets[0].evidence_kind, 'reference');
  assert.equal(result.summaries[0].metadata.total, '350 domains');
  assert.equal(result.statuses[0].source.providerId, 'odint:cyber-recon-tour');
});

test('ODINT API inventory emits only explicit URLs and leaves relative routes in summaries', () => {
  const text = [
    'API ENDPOINT MAP: SAT (Tax Authority)',
    '',
    'BASE URL: https://repodatos.atdt.gob.mx/api_update/',
    'AGENCY PATH: /api_update/SAT/',
    'FULL ENDPOINT: https://repodatos.atdt.gob.mx/api_update/SAT/',
    'ACCESS STATUS: OPEN (No Authentication Required)',
    '',
    'FILE: SAT_1_Donatarias_Aut.csv',
    '  Route: /api_update/SAT/SAT_1_Donatarias_Aut.csv',
    '  Size: 27M',
  ].join('\n');

  const result = normalizeOdintCyberRecon({
    files: [{ path: 'CYBER RECON TOUR/North America/Mexico/api/SAT (Tax Authority).txt', text }],
    collectedAt,
  });

  assert.equal(result.targets.length, 2);
  assert.equal(result.targets[0].target_kind, 'api_endpoint');
  assert.equal(result.targets[0].domain, 'repodatos.atdt.gob.mx');
  assert.equal(result.targets.some((target) => target.url?.endsWith('SAT_1_Donatarias_Aut.csv')), false);
  assert.equal(result.summaries[0].country, 'Mexico');
  assert.equal(result.summaries[0].metadata.access_status, 'OPEN (No Authentication Required)');
});

test('ODINT normalizer omits unavailable files and prose without synthetic targets', () => {
  const text = [
    'SAT (Tax Authority).txt          - 464K taxpayer records',
    'This sentence describes the source but does not provide a hostname.',
    'example.invalid/path-without-protocol',
  ].join('\n');

  const result = normalizeOdintCyberRecon({
    files: [
      { path: 'CYBER RECON TOUR/North America/Mexico/api/00-API-INDEX.txt', text },
      { path: 'CYBER RECON TOUR/Europe/missing-websites.txt', text: null },
    ],
    collectedAt,
  });

  assert.equal(result.counts.receivedFiles, 2);
  assert.equal(result.counts.acceptedFiles, 1);
  assert.equal(result.counts.rejectedFiles, 1);
  assert.equal(result.targets.length, 0);
  assert.equal(result.summaries.length, 1);
});

test('FED intelligence normalizer parses explicit agency bullets with source provenance', () => {
  const spy = [
    '## Table of Contents',
    '- [United States](#united-states)',
    '',
    '## Afghanistan',
    '- **NDS** (National Directorate of Security)',
    '  - Intelligence agency (historical)',
    '',
    '## United States',
    '### Signals Intelligence & Cyber',
    '- **NSA** (National Security Agency)',
    '  - https://www.nsa.gov',
    '  - SIGINT, cybersecurity, cryptanalysis',
    '- United States (NSA, CIA)',
  ].join('\n');

  const result = normalizeFedRolodex({
    spyMarkdown: spy,
    culturalMarkdown: null,
    collectedAt,
  });

  assert.equal(result.counts.acceptedIntelligenceEntities, 2);
  assert.equal(result.intelligenceEntities[0].name, 'NDS');
  assert.equal(result.intelligenceEntities[0].country, 'Afghanistan');
  const nsa = result.intelligenceEntities.find((entity) => entity.name === 'NSA');
  assert.ok(nsa);
  assert.equal(nsa.alternate_name, 'National Security Agency');
  assert.equal(nsa.website, 'https://www.nsa.gov/');
  assert.equal(nsa.category, 'Signals Intelligence & Cyber');
  assert.equal(nsa.evidence_kind, 'reference');
  assert.equal(result.counts.rejectedRecordLines, 1);
  assert.equal(result.statuses[0].source.providerId, 'fed:spy-vs-spy');
});

test('FED cultural center normalizer parses center lists while omitting narrative bullets', () => {
  const cultural = [
    '## Introduction',
    '- **Cover for Intelligence Officers**: narrative bullet before records',
    '',
    '## Afghanistan',
    '**Afghan Cultural Centers Abroad**',
    '- **Afghan Cultural Center** (United States)',
    '  - Locations: Washington DC, New York',
    '',
    '## Australia',
    '### Australian Cultural Centers (Regional Network - 15+ Locations)',
    '#### **LOCATIONS**',
    '- Australian Cultural Centre Jakarta, Indonesia',
    '- Australian Cultural Centre Beijing, China',
    '### Intelligence Connections: ASIS/ASIO coordination',
    '- Cultural attachés frequently serve as cover',
    '**Foreign Cultural Centers in Australia**',
    '- **Goethe-Institut** (Melbourne, Sydney)',
    '  - https://www.goethe.de/ins/au/en/index.html',
  ].join('\n');

  const result = normalizeFedRolodex({
    spyMarkdown: null,
    culturalMarkdown: cultural,
    collectedAt,
  });

  assert.equal(result.counts.acceptedCulturalCenters, 4);
  assert.equal(result.culturalCenters[0].name, 'Afghan Cultural Center');
  assert.equal(result.culturalCenters[0].country, 'Afghanistan');
  const jakarta = result.culturalCenters.find((center) => center.name.includes('Jakarta'));
  assert.ok(jakarta);
  assert.equal(jakarta.location_context, 'LOCATIONS');
  const goethe = result.culturalCenters.find((center) => center.name === 'Goethe-Institut');
  assert.ok(goethe);
  assert.equal(goethe.website, 'https://www.goethe.de/ins/au/en/index.html');
  assert.equal(goethe.network, 'Goethe-Institut');
  assert.equal(result.culturalCenters.some((center) => center.name.includes('attachés')), false);
});

test('FED normalizer omits unavailable Markdown databases without generating records', () => {
  const result = normalizeFedRolodex({
    readmeMarkdown: null,
    spyMarkdown: null,
    culturalMarkdown: null,
    collectedAt,
  });

  assert.equal(result.counts.receivedFiles, 3);
  assert.equal(result.counts.acceptedFiles, 0);
  assert.equal(result.intelligenceEntities.length, 0);
  assert.equal(result.culturalCenters.length, 0);
  assert.equal(result.statuses.length, 0);
});

test('global data center map plots only source GeoJSON points and summarizes the full JSON catalog', () => {
  const result = normalizeGlobalDataCenters({
    datacentersJson: JSON.stringify([
      {
        name: 'JSON-only data center',
        company: 'Example Operator',
        city: 'NoGeo City',
        state: '',
        country: 'Exampleland',
        address: 'NoGeo City Exampleland',
        city_coords: [10, 20],
      },
      {
        name: 'Mapped data center',
        company: 'Equinix',
        city: 'Madrid',
        state: '',
        country: 'Spain',
        address: 'Madrid Spain',
      },
    ]),
    datacentersGeoJson: JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-3.7038, 40.4168] },
          properties: {
            name: 'Mapped data center',
            company: 'Equinix',
            city: 'Madrid',
            state: '',
            country: 'Spain',
            address: 'Madrid Spain',
          },
        },
      ],
    }),
    statisticsMarkdown: '- **Total Data Centers**: 18,110\n',
    collectedAt,
  });

  assert.equal(result.counts.receivedFacilities, 2);
  assert.equal(result.counts.acceptedCoordinateFacilities, 1);
  assert.equal(result.dataCenters.length, 1);
  assert.equal(result.dataCenters[0].name, 'Mapped data center');
  assert.equal(result.dataCenters[0].location_precision, 'unknown');
  assert.equal(result.dataCenters[0].integrity.location.resolutionMethod, 'upstream_geojson_coordinate');
  assert.equal(result.summaries[0].total_facilities, 2);
  assert.equal(result.summaries[0].coordinate_facilities, 1);
  assert.equal(result.summaries[0].metadata.total_data_centers, '18,110');
});

test('global data center map omits invalid coordinate sources instead of inferring locations', () => {
  const result = normalizeGlobalDataCenters({
    datacentersJson: JSON.stringify([
      {
        name: 'Catalog-only facility',
        company: 'Example Operator',
        city: 'Catalog City',
        country: 'Exampleland',
        address: 'Catalog City Exampleland',
        city_coords: [35, -90],
      },
    ]),
    datacentersGeoJson: JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [220, 95] },
          properties: { name: 'Invalid point', company: 'Example Operator' },
        },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-1, 1], [1, 2]] },
          properties: { name: 'Line is not a facility point' },
        },
      ],
    }),
    collectedAt,
  });

  assert.equal(result.counts.receivedFacilities, 1);
  assert.equal(result.counts.acceptedCoordinateFacilities, 0);
  assert.equal(result.counts.rejectedCoordinateFacilities, 2);
  assert.equal(result.dataCenters.length, 0);
  assert.equal(result.summaries[0].total_facilities, 1);
  assert.equal(result.statuses.find((status) => status.source.providerId === 'data-center-map:datacenters-geojson')?.availability, 'error');
});

test('OUI master database parser matches MAC prefixes without guessing missing fields', () => {
  const csv = [
    'oui,manufacturer,registry,short_name,device_type,registered_date,address,sources',
    '00:00:0C,"Cisco Systems, Inc",MA-L,Cisco,Router,2023-07-12,"80 West Tasman Drive, San Jose CA US",IEEE+Wireshark+Nmap',
    'E4:F1:4C,Private,MA-L,,,2017-10-22,"",IEEE+Nmap',
  ].join('\n');

  const parsed = parseOuiCsv(csv);
  const mac = normalizeMacInput('00-00-0c-12-34-56');
  assert.ok(mac);
  assert.equal(mac.oui, '00:00:0C');
  const record = lookupOuiRecord(parsed.records, mac);
  assert.ok(record);
  const result = buildOuiLookupResult(mac, record, collectedAt);
  assert.equal(result.vendor, 'Cisco Systems, Inc');
  assert.equal(result.device_type, 'Router');
  assert.deepEqual(result.sources, ['IEEE', 'Wireshark', 'Nmap']);

  const privateMac = normalizeMacInput('E4:F1:4C:00:00:01');
  assert.ok(privateMac);
  const privateRecord = lookupOuiRecord(parsed.records, privateMac);
  assert.ok(privateRecord);
  assert.equal(privateRecord.device_type, null);
  assert.equal(privateRecord.address, null);

  const missing = normalizeMacInput('AA:BB:CC:00:00:01');
  assert.ok(missing);
  assert.equal(lookupOuiRecord(parsed.records, missing), null);
  assert.equal(buildOuiLookupResult(missing, null, collectedAt).vendor, 'Not Found');
});

test('OUI master lookup prefers the most specific registered prefix', () => {
  const csv = [
    'oui,manufacturer,registry,short_name,device_type,registered_date,address,sources',
    '00:00:0C,"Cisco Systems, Inc",MA-L,Cisco,Router,2023-07-12,"San Jose CA US",IEEE+Wireshark+Nmap',
    '00:00:0C:A,"Example Medium Block",MA-M,,,,IEEE',
    '00:00:0C:A1:B,"Example Small Block",MA-S,,,,IEEE',
  ].join('\n');

  const parsed = parseOuiCsv(csv);
  assert.equal(parsed.acceptedRecords, 3);
  const mac = normalizeMacInput('00:00:0C:A1:B2:33');
  assert.ok(mac);
  const record = lookupOuiRecord(parsed.records, mac);
  assert.ok(record);
  assert.equal(record.manufacturer, 'Example Small Block');
  assert.equal(record.registry, 'MA-S');
});

test('OUI master parser handles slash-notated IEEE /36 prefixes', () => {
  const csv = [
    'oui,manufacturer,registry,short_name,device_type,registered_date,address,sources',
    '00:1B:C5:00:00/36,"Example IAB Block",IAB,,,,IEEE',
  ].join('\n');

  const parsed = parseOuiCsv(csv);
  assert.equal(parsed.acceptedRecords, 1);
  const mac = normalizeMacInput('00:1B:C5:00:01:FF');
  assert.ok(mac);
  const record = lookupOuiRecord(parsed.records, mac);
  assert.ok(record);
  assert.equal(record.oui, '00:1B:C5:00:0');
  assert.equal(record.manufacturer, 'Example IAB Block');
});

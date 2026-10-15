import test from 'node:test';
import assert from 'node:assert/strict';
import rawCatalog from '../src/data/infrastructure-sources.json';
import { INFRASTRUCTURE_SOURCES, INFRASTRUCTURE_SECTORS, INFRASTRUCTURE_TTL_MS, parseInfrastructureBounds } from '../src/lib/infrastructure-catalog';
import { buildInfrastructureQuery, createInfrastructureCollector, INFRASTRUCTURE_PROVIDERS, normalizeInfrastructure } from '../src/lib/feed-integrity/infrastructure';
import { evaluateCapabilityPayload, getSourceContract } from '../src/lib/source-contracts';
import { SOURCE_CAPABILITIES, statusesForCapability } from '../src/lib/source-manifest';
import { layerMenuGroupForKey } from '../src/lib/layer-menu';
import { importInfrastructureGeoJson } from '../src/lib/infrastructure-import';
import { infrastructureStatusAt } from '../src/lib/infrastructure-source';

const nowMs = Date.parse('2026-10-15T12:00:00Z');
const collectedAt = new Date(nowMs).toISOString();
const bounds: [number, number, number, number] = [25.45, 42.68, 25.50, 42.72];
const node = { type: 'node', id: 42, lat: 42.70, lon: 25.48, tags: { name: 'Source facility', power: 'substation' }, timestamp: '2018-01-01T00:00:00Z' };
const way = { type: 'way', id: 43, tags: { man_made: 'water_works' }, geometry: [
  { lon: 25.46, lat: 42.69 }, { lon: 25.47, lat: 42.69 }, { lon: 25.47, lat: 42.70 }, { lon: 25.46, lat: 42.69 },
] };
const payload = (elements: unknown[] = [node], updatedAt = collectedAt) => ({ elements, osm3s: { timestamp_osm_base: updatedAt } });
const response = (value: unknown = payload()) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('all 28 catalog rows retain original content and explicit connection restrictions', () => {
  assert.equal(INFRASTRUCTURE_SOURCES.length, 28);
  assert.equal(new Set(INFRASTRUCTURE_SOURCES.map((source) => source.id)).size, 28);
  for (const row of rawCatalog) {
    const source = INFRASTRUCTURE_SOURCES.find((item) => item.id === row.ID)!;
    assert.equal(source.name, row['Source / product']);
    assert.equal(source.limitation, row['Main limitation']);
    assert.equal(source.license, row['License / permission']);
    assert.equal(source.vintage, row['Vintage / update notes']);
    assert.equal(source.url, row['Source URL']);
    assert.equal(source.termsUrl, row['Evidence / terms URL']);
    assert.equal(source.reviewDate, '2026-10-15');
    assert.ok(source.sectors.length);
    assert.ok(source.alternatives.length);
    for (const id of source.alternatives) assert.ok(INFRASTRUCTURE_SOURCES.some((candidate) => candidate.id === id && candidate.id !== source.id));
  }
  const access = (id: string) => INFRASTRUCTURE_SOURCES.find((source) => source.id === id)!.access;
  assert.equal(access('S14'), 'Not available');
  assert.equal(access('S15'), 'Credentials required');
  assert.equal(access('S16'), 'Permission required');
  assert.equal(access('S17'), 'Commercial license');
  assert.equal(access('S07'), 'Modeled reference');
  assert.equal(access('S28'), 'Historical reference');
  assert.deepEqual(INFRASTRUCTURE_SOURCES.filter((source) => source.access === 'Mapped via OSM').map((source) => source.id), ['S01']);
});

test('five sector layers have menu entries, diagnostics, and optional reference contracts', () => {
  for (const sector of INFRASTRUCTURE_SECTORS) {
    assert.equal(layerMenuGroupForKey(sector.layerKey)?.label, 'INFRA');
    const capability = SOURCE_CAPABILITIES.find((item) => item.id === `infrastructure-${sector.id}`)!;
    assert.equal(capability.layerId, sector.layerKey);
    assert.equal(getSourceContract(capability.id)?.requirement, 'optional');
    assert.equal(getSourceContract(capability.id)?.recordSets[0].liveObservation, false);
  }
  assert.equal(layerMenuGroupForKey('infra_sources')?.label, 'INFRA');
});

test('bounds reject global, missing, malformed, reversed and antimeridian queries', () => {
  assert.deepEqual(parseInfrastructureBounds(bounds.join(',')), bounds);
  for (const value of [null, '', ',1,2,3', '1,2,3', '1,2,3,4,5', '-180,-90,180,90', '179,10,-179,11', '1,2,1,3', '0,0,1.1,1', '0,0,1,1.1', 'NaN,0,1,1', '0,0,Infinity,1', '0,0,1,1);out;']) {
    assert.equal(parseInfrastructureBounds(value), null, String(value));
  }
  const query = buildInfrastructureQuery(bounds, INFRASTRUCTURE_SECTORS.map((sector) => sector.id));
  assert.ok(query.includes('(42.68,25.45,42.72,25.5)'));
  assert.ok(query.includes('construction:|disused:|abandoned:|demolished:'));
  assert.ok(query.includes('out meta geom 5001;'));
  assert.doesNotMatch(query, /out\s+center/);
});

test('source nodes, lines and polygons retain original geometry, IDs, lifecycle and edit dates', () => {
  const line = { ...way, id: 44, tags: { 'disused:power': 'line', name: 'Historical line' } };
  const result = normalizeInfrastructure(payload([node, node, way, line]), ['power', 'water'], collectedAt);
  assert.equal(result.assets.length, 3);
  assert.deepEqual(result.assets[0].geometry, { type: 'Point', coordinates: [25.48, 42.70] });
  assert.equal(result.assets[0].id, 'osm:node/42');
  assert.equal(result.assets[0].sourceUpdatedAt, '2018-01-01T00:00:00.000Z');
  assert.equal(result.assets[0].evidence_kind, 'reference');
  assert.equal(result.assets[1].geometry.type, 'Polygon');
  assert.equal(result.assets[2].geometry.type, 'LineString');
  assert.equal(result.assets[2].tags['disused:power'], 'line');
  assert.equal('lat' in result.assets[1], false, 'Polygons do not get guessed centroid coordinates');
});

test('malformed, incomplete, stale and unusable provider records cannot become healthy empty streams', () => {
  for (const value of [null, {}, { elements: [] }, { ...payload(), remark: 'runtime error: Query timed out' },
    payload([], '2020-01-01'), payload([], '2026-10-15T13:00:00Z'), payload([], 'invalid'),
    payload([{ ...node, lat: null }]), payload([{ ...node, lon: '25.48' }]), payload([{ ...node, id: -1 }]),
    payload([{ ...node, type: 'relation' }]), payload([{ ...way, geometry: [{ lon: 25, lat: 42 }, { lon: null, lat: 43 }] }]),
    payload([node, { ...way, geometry: [] }]), payload(Array(5001).fill(node)),
  ]) assert.throws(() => normalizeInfrastructure(value, ['power', 'water'], collectedAt));
  assert.deepEqual(normalizeInfrastructure(payload([]), ['medical'], collectedAt).assets, []);
});

test('collector coalesces, caches without rewriting timestamps, and recollects after expiry', async () => {
  let now = nowMs;
  let calls = 0;
  const collect = createInfrastructureCollector({ now: () => now, fetcher: async () => { calls++; return response(payload([node], new Date(now).toISOString())); } });
  const [first, second] = await Promise.all([collect(bounds, ['power']), collect(bounds, ['power'])]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  now += 60_000;
  const cached = await collect(bounds, ['power']);
  assert.equal(cached.fetchedAt, collectedAt);
  assert.equal(cached.status[0].lastSuccessfulFetchAt, collectedAt);
  assert.equal(calls, 1);
  now += INFRASTRUCTURE_TTL_MS;
  const fresh = await collect(bounds, ['power']);
  assert.equal(calls, 2);
  assert.notEqual(fresh.fetchedAt, collectedAt);
  assert.ok(Date.parse(fresh.expiresAt!) > now);
});

test('cached infrastructure diagnostics age out without renewing collection timestamps', async () => {
  const collect = createInfrastructureCollector({ now: () => nowMs, fetcher: async () => response() });
  const status = (await collect(bounds, ['power'])).status[0];
  assert.equal(infrastructureStatusAt(status, nowMs).availability, 'ok');
  const aged = infrastructureStatusAt(status, nowMs + INFRASTRUCTURE_TTL_MS);
  assert.equal(aged.availability, 'error');
  assert.equal(aged.dataState, 'unavailable');
  assert.equal(aged.freshness, 'stale');
  assert.equal(aged.acceptedRecords, 0);
  assert.equal(aged.lastSuccessfulFetchAt, collectedAt);
  assert.equal(status.availability, 'ok', 'Aging must not mutate the stored snapshot');
  assert.equal(infrastructureStatusAt({ ...status, lastSuccessfulFetchAt: 'invalid' }, nowMs).freshness, 'unknown');
});

test('alternate provider failures remain visible, with status counts separated by sector', async () => {
  const urls: string[] = [];
  const collect = createInfrastructureCollector({ now: () => nowMs, fetcher: async (url, options) => {
    urls.push(String(url));
    assert.equal(options?.redirect, 'error');
    return urls.length === 1 ? new Response('Busy', { status: 429 }) : response(payload([node, way]));
  } });
  const result = await collect(bounds, ['power', 'water', 'medical']);
  assert.deepEqual(urls, INFRASTRUCTURE_PROVIDERS.map((provider) => provider.url));
  assert.equal(result.assets.length, 2);
  assert.equal(result.status.length, 6);
  assert.equal(result.status[0].availability, 'error');
  assert.equal(result.status[3].acceptedRecords, 1);
  assert.equal(result.status[4].acceptedRecords, 1);
  assert.equal(result.status[5].acceptedRecords, 0);
  assert.equal(result.status[5].dataState, 'empty');
  for (const sector of ['power', 'water', 'medical']) {
    const capability = SOURCE_CAPABILITIES.find((item) => item.id === `infrastructure-${sector}`)!;
    assert.equal(statusesForCapability(capability, result.status).length, 2);
    const evaluation = evaluateCapabilityPayload({ contract: getSourceContract(capability.id)!, httpStatus: 200, contentType: 'application/json', nowMs,
      payload: { ...result, assets: result.assets.filter((asset) => asset.sectors.includes(sector as 'power')), status: result.status.filter((status) => status.source.providerId.startsWith(`${capability.id}:`)) },
      renderingChecked: false, env: {} });
    assert.equal(evaluation.passed, true, evaluation.messages.join(' '));
  }
});

test('provider failures omit assets, disclose alternates and use short negative caching', async () => {
  let now = nowMs;
  let calls = 0;
  const collect = createInfrastructureCollector({ now: () => now, fetcher: async () => { calls++; return response({ malformed: true }); } });
  const result = await collect(bounds, ['power']);
  assert.deepEqual(result.assets, []);
  assert.equal(result.fetchedAt, null);
  assert.equal(result.expiresAt, null);
  assert.ok(result.error);
  assert.ok(result.status.every((status) => status.availability === 'error' && status.acceptedRecords === 0));
  assert.ok(result.alternate_sources.some((source) => source.url === 'https://download.geofabrik.de/'));
  await collect(bounds, ['power']);
  assert.equal(calls, 2);
  now += 31_000;
  await collect(bounds, ['power']);
  assert.equal(calls, 4);
});

test('true schema-valid empty areas remain distinct from unavailable data', async () => {
  const collect = createInfrastructureCollector({ now: () => nowMs, fetcher: async () => response(payload([])) });
  const result = await collect(bounds, ['medical']);
  assert.equal(result.error, undefined);
  assert.equal(result.status[0].dataState, 'empty');
  assert.equal(result.status[0].availability, 'ok');
  assert.equal(result.fetchedAt, collectedAt);
});

test('oversized and network-timeout responses fail closed', async () => {
  for (const fetcher of [
    async () => new Response('{}', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }),
    async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)),
    async (_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('timeout')))),
  ]) {
    const collect = createInfrastructureCollector({ fetcher, now: () => nowMs, timeoutMs: 10 });
    const result = await collect(bounds, ['power']);
    assert.ok(result.error);
    assert.deepEqual(result.assets, []);
  }
});

test('uncached query bursts are limited while cached queries remain available', async () => {
  const collect = createInfrastructureCollector({ now: () => nowMs, fetcher: async () => response() });
  await collect(bounds, ['power']);
  await assert.rejects(collect(bounds, ['medical']), /cooldown/);
  assert.equal((await collect(bounds, ['power'])).assets.length, 1);
});

test('provider Retry-After is honored across different query keys', async () => {
  let now = nowMs;
  const urls: string[] = [];
  const collect = createInfrastructureCollector({ now: () => now, fetcher: async (url) => {
    urls.push(String(url));
    return String(url) === INFRASTRUCTURE_PROVIDERS[0].url ? new Response('Limited', { status: 429, headers: { 'Retry-After': '3600' } }) : response(payload([], new Date(now).toISOString()));
  } });
  const first = await collect(bounds, ['power']);
  assert.equal(first.status[0].nextRetryAt, new Date(now + 3600_000).toISOString());
  now += 60_000;
  await collect(bounds, ['medical']);
  assert.deepEqual(urls, [INFRASTRUCTURE_PROVIDERS[0].url, INFRASTRUCTURE_PROVIDERS[1].url, INFRASTRUCTURE_PROVIDERS[1].url]);
});

test('local imports preserve source geometry, license and vintage without inventing locations or dates', () => {
  const data = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'source-123', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Source WWTP', population: 25 } }] };
  const assets = importInfrastructureGeoJson(JSON.stringify(data), 'S08', 'wastewater', collectedAt, 'CC BY 4.0');
  assert.equal(assets[0].id, 'import:S08:source-123');
  assert.deepEqual(assets[0].geometry, data.features[0].geometry);
  assert.equal(assets[0].source_id, 'S08');
  assert.equal(assets[0].sourceUpdatedAt, null);
  assert.equal(assets[0].collectedAt, collectedAt);
  assert.equal(assets[0].coordinate_precision, 'unknown');
  assert.equal(assets[0].tags.dataset_license, 'CC BY 4.0');
  assert.match(assets[0].tags.catalog_vintage, /Version 1/);
  assert.equal(assets[0].tags.population, '25');
  assert.equal(importInfrastructureGeoJson(JSON.stringify(data), 'S08', 'wastewater', collectedAt, 'CC BY 4.0')[0].id, assets[0].id);
});

test('local imports reject restricted, modeled, approximate-only and wrong-sector catalog sources', () => {
  const text = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [25, 42] } }] });
  for (const id of ['S07', 'S14', 'S15', 'S16', 'S17', 'S18', 'S22', 'S23', 'S27', 'S28', 'unknown']) {
    assert.throws(() => importInfrastructureGeoJson(text, id, 'telecom', collectedAt, 'Permission'), /eligible/);
  }
  assert.throws(() => importInfrastructureGeoJson(text, 'S08', 'power', collectedAt, 'CC BY 4.0'), /eligible/);
  assert.throws(() => importInfrastructureGeoJson(text, 'S08', 'wastewater', collectedAt, ''), /license/);
});

test('local import refuses unsupported geometry, missing coordinates, custom CRS, conflicts and oversized files', () => {
  const point = { type: 'Feature', id: 'A', geometry: { type: 'Point', coordinates: [25, 42] }, properties: {} };
  for (const value of [{}, { type: 'FeatureCollection', features: [] }, { type: 'FeatureCollection', features: [point], crs: { type: 'EPSG:3857' } },
    { type: 'FeatureCollection', features: [{ ...point, geometry: null }] },
    { type: 'FeatureCollection', features: [{ ...point, geometry: { type: 'Point', coordinates: [null, 42] } }] },
    { type: 'FeatureCollection', features: [{ ...point, geometry: { type: 'Point', coordinates: ['25', 42] } }] },
    { type: 'FeatureCollection', features: [{ ...point, geometry: { type: 'LineString', coordinates: [[25, 42], [25, 42]] } }] },
    { type: 'FeatureCollection', features: [{ ...point, geometry: { type: 'Polygon', coordinates: [[[25, 42], [26, 42], [26, 43]]] } }] },
    { type: 'FeatureCollection', features: [point, { ...point, geometry: { type: 'Point', coordinates: [26, 42] } }] },
    { type: 'FeatureCollection', features: Array(10_001).fill(point) },
  ]) assert.throws(() => importInfrastructureGeoJson(JSON.stringify(value), 'S08', 'wastewater', collectedAt, 'CC BY 4.0'));
  assert.throws(() => importInfrastructureGeoJson(' '.repeat(10 * 1024 * 1024 + 1), 'S08', 'wastewater', collectedAt, 'CC BY 4.0'), /10 MiB/);
});

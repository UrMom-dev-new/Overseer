import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScmSupplierOverlay, type ScmSourceCollection } from '../src/lib/scm-suppliers';

function source(records: unknown[], overrides: Partial<ScmSourceCollection> = {}): ScmSourceCollection {
  return {
    source: 'test-source',
    availability: 'ok',
    dataState: records.length > 0 ? 'present' : 'empty',
    message: 'test source returned',
    records,
    ...overrides,
  };
}

test('SCM overlay consumes fires records from the fires field without localhost port assumptions', async () => {
  const payload = await buildScmSupplierOverlay({
    earthquakes: async () => source([]),
    fires: async () => source([{ id: 'fire-near-tsmc', lat: 24.78, lng: 121.0 }], { source: 'fires-route' }),
    gdelt: async () => source([]),
  }, '2026-09-16T12:00:00.000Z');

  const tsmc = payload.suppliers.find((supplier) => supplier.id === 'sup-tsmc-hsinchu');
  assert.ok(tsmc);
  assert.equal(tsmc.exposure_indicators.some((indicator) => indicator.label === 'thermal_detection_proximity'), true);
  assert.equal(payload.source_status.find((status) => status.source === 'fires-route')?.dataState, 'present');
});

test('SCM overlay isolates provider failures and still applies later source results', async () => {
  const payload = await buildScmSupplierOverlay({
    earthquakes: async () => {
      throw new Error('earthquake collector failed');
    },
    fires: async () => source([]),
    gdelt: async () => source([{ id: 'gdelt-near-samsung', lat: 37.22, lng: 127.1 }], { source: 'gdelt-route' }),
  }, '2026-09-16T12:00:00.000Z');

  assert.equal(payload.source_status.find((status) => status.source === 'USGS earthquakes')?.availability, 'error');
  const samsung = payload.suppliers.find((supplier) => supplier.id === 'sup-sec-giheung');
  assert.ok(samsung);
  assert.equal(samsung.exposure_indicators.some((indicator) => indicator.label === 'news_mention_proximity'), true);
  assert.equal(payload.critical_count, null);
  assert.equal(payload.risk_assessment_state, 'not_assessed');
});

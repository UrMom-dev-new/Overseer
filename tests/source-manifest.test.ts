import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_CAPABILITIES,
  sourceConfigurationState,
  statusForCapability,
  statusesForCapability,
} from '../src/lib/source-manifest';
import { collectionStatus, sourceIdentity } from '../src/lib/feed-integrity';

test('source capabilities have unique IDs and concrete API routes', () => {
  const ids = new Set<string>();
  for (const capability of SOURCE_CAPABILITIES) {
    assert.equal(ids.has(capability.id), false, `${capability.id} is duplicated`);
    ids.add(capability.id);
    assert.match(capability.apiRoute, /^\/api\//);
    assert.ok(capability.providerDocs.length > 0);
    assert.ok(capability.normalizedContract.length > 0);
  }
});

test('configuration states distinguish keyless, optional, and required sources', () => {
  const byId = new Map(SOURCE_CAPABILITIES.map((capability) => [capability.id, capability]));
  assert.equal(sourceConfigurationState(byId.get('earthquakes')!, {}), 'keyless');
  assert.equal(sourceConfigurationState(byId.get('flights')!, {}), 'optional');
  assert.equal(sourceConfigurationState(byId.get('scanner')!, {}), 'not_configured');
  assert.equal(sourceConfigurationState(byId.get('scanner')!, { SCANNER_URL: 'http://scanner', SCANNER_KEY: 'secret' }), 'configured');
});

test('source status mapping keeps alternates visible and chooses a healthy primary summary', () => {
  const capability = SOURCE_CAPABILITIES.find((candidate) => candidate.id === 'flights');
  assert.ok(capability);

  const statuses = [
    collectionStatus({
      source: sourceIdentity('flights', 'OpenSky Network', 'https://opensky-network.org'),
      availability: 'error',
      dataState: 'unavailable',
      acceptedRecords: 0,
    }),
    collectionStatus({
      source: sourceIdentity('flights:adsb-lol-military', 'ADSB.lol military', 'https://api.adsb.lol'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 12,
    }),
  ];

  const matches = statusesForCapability(capability, statuses);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].source.providerId, 'flights:adsb-lol-military');
  assert.equal(statusForCapability(capability, statuses)?.availability, 'ok');
});

test('source status mapping recognizes provider-specific IDs', () => {
  const capability = SOURCE_CAPABILITIES.find((candidate) => candidate.id === 'earthquakes');
  assert.ok(capability);
  const status = collectionStatus({
    source: sourceIdentity('usgs-earthquakes', 'USGS earthquakes', 'https://earthquake.usgs.gov'),
    availability: 'ok',
    dataState: 'present',
  });
  assert.equal(statusForCapability(capability, [status])?.source.providerId, 'usgs-earthquakes');
});

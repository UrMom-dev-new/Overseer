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

test('source status mapping recognizes OUI lookup providers', () => {
  const capability = SOURCE_CAPABILITIES.find((candidate) => candidate.id === 'mac-vendor-lookup');
  assert.ok(capability);
  const statuses = [
    collectionStatus({
      source: sourceIdentity('oui-master-database:master-csv', 'OUI Master CSV', 'https://raw.githubusercontent.com/Ringmast4r/OUI-Master-Database/master/LISTS/master_oui.csv'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 90168,
    }),
    collectionStatus({
      source: sourceIdentity('macvendors-co', 'macvendors.co API', 'https://macvendors.co/api'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 1,
    }),
  ];
  assert.equal(statusesForCapability(capability, statuses).length, 2);
  assert.equal(statusForCapability(capability, statuses)?.source.providerId, 'oui-master-database:master-csv');
});

test('source status mapping recognizes ODINT providers', () => {
  const capability = SOURCE_CAPABILITIES.find((candidate) => candidate.id === 'odint-targets');
  assert.ok(capability);
  const statuses = [
    collectionStatus({
      source: sourceIdentity('odint:github-tree', 'ODINT GitHub tree API', 'https://api.github.com/repos/Ringmast4r/ODINT/git/trees/main?recursive=1'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 702,
    }),
    collectionStatus({
      source: sourceIdentity('odint:cyber-recon-tour', 'ODINT CYBER RECON TOUR', 'https://github.com/Ringmast4r/ODINT'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 5000,
    }),
  ];
  assert.equal(statusesForCapability(capability, statuses).length, 2);
  assert.equal(statusForCapability(capability, statuses)?.source.providerId, 'odint:github-tree');
});

test('source status mapping recognizes FED providers', () => {
  const capability = SOURCE_CAPABILITIES.find((candidate) => candidate.id === 'fed-rolodex');
  assert.ok(capability);
  const statuses = [
    collectionStatus({
      source: sourceIdentity('fed:spy-vs-spy', 'FED SPY vs SPY', 'https://github.com/Ringmast4r/FED/blob/master/spy-vs-spy.md'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 925,
    }),
    collectionStatus({
      source: sourceIdentity('fed:cultural-centers', 'FED Culture as Cover', 'https://github.com/Ringmast4r/FED/blob/master/cultural-centers.md'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 3500,
    }),
  ];
  assert.equal(statusesForCapability(capability, statuses).length, 2);
  assert.equal(statusForCapability(capability, statuses)?.source.providerId, 'fed:spy-vs-spy');
});

test('source status mapping recognizes Global Data Center Map providers', () => {
  const capability = SOURCE_CAPABILITIES.find((candidate) => candidate.id === 'data-centers');
  assert.ok(capability);
  const statuses = [
    collectionStatus({
      source: sourceIdentity('data-center-map:datacenters-json', 'Global Data Center Map deduplicated JSON', 'https://github.com/Ringmast4r/Global-Data-Center-Map/blob/main/datacenters.json'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 18110,
    }),
    collectionStatus({
      source: sourceIdentity('data-center-map:datacenters-geojson', 'Global Data Center Map coordinate GeoJSON', 'https://github.com/Ringmast4r/Global-Data-Center-Map/blob/main/datacenters.geojson'),
      availability: 'ok',
      dataState: 'present',
      acceptedRecords: 6131,
    }),
  ];
  assert.equal(statusesForCapability(capability, statuses).length, 2);
  assert.equal(statusForCapability(capability, statuses)?.source.providerId, 'data-center-map:datacenters-json');
});

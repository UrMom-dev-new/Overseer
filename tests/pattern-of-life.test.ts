import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectPatternFormat,
  parseDelimitedText,
  processPatternOfLifeFiles,
  sheetRowsFromMatrix,
} from '../src/lib/pattern-of-life';

test('pattern parser preserves quoted CSV fields and detects generic coordinates', () => {
  const rows = parseDelimitedText('timestamp,latitude,longitude,event,address\n"2026-01-02 03:04:00","39.1","-94.5","ping","HQ, North"\n');
  const sheet = sheetRowsFromMatrix(rows);

  assert.equal(sheet.rows[0].address, 'HQ, North');
  assert.equal(detectPatternFormat(sheet), 'generic');
});

test('CDR rows with invalid coordinates are omitted unless a usable cell identifier is present', () => {
  const analysis = processPatternOfLifeFiles([
    {
      name: 'cdr.csv',
      text: [
        'Date,Time,1st Tower LAT,1st Tower LONG,Direction,Call Type,Dialed Number,Duration,1st LAC,1st Cell ID,MCC,MNC',
        '01/02/2026,03:04:00,39.1000,-94.5000,Outgoing,Voice,+15551234567,60,10,20,310,260',
        '01/02/2026,04:04:00,500,-94.5000,Outgoing,Voice,+15557654321,30,,,,',
        '01/02/2026,05:04:00,500,-94.5000,Incoming,Voice,+15550001111,15,11,21,310,260',
      ].join('\n'),
    },
  ], {}, { timeZone: 'UTC' });

  assert.equal(analysis.stats.cdrEvents, 2);
  assert.equal(analysis.stats.recordsOmitted, 1);
  assert.equal(analysis.stats.geocodedEvents, 1);
  assert.equal(analysis.stats.unmappedCells, 1);
  assert.equal(analysis.contacts.length, 2);
});

test('tower survey observations enrich CDR rows that only contain cell IDs', () => {
  const analysis = processPatternOfLifeFiles([
    {
      name: 'cdr.csv',
      text: [
        'Date,Time,Direction,Call Type,Dialed Number,Duration,1st LAC,1st Cell ID,MCC,MNC',
        '01/02/2026,03:04:00,Outgoing,Voice,+15551234567,60,10,20,310,260',
      ].join('\n'),
    },
    {
      name: 'survey.csv',
      text: [
        'mcc,mnc,lac,cellid,lat,lon,signal,radio,time',
        '310,260,10,20,39.1000,-94.5000,-75,LTE,2026-01-02T03:00:00Z',
        '310,260,10,20,39.1005,-94.5005,-80,LTE,2026-01-02T03:01:00Z',
      ].join('\n'),
    },
  ], {}, { timeZone: 'UTC' });

  assert.equal(analysis.stats.enrichedEvents, 1);
  assert.equal(analysis.stats.geocodedEvents, 1);
  assert.equal(analysis.stats.unmappedCells, 0);
  assert.equal(analysis.cellReferences[0].source, 'survey');
  assert.equal(analysis.cdr[0].geoSource, 'survey');
});

test('imported open cell-reference datasets enrich CDR rows without lookup services', () => {
  const datasetRows = parseDelimitedText([
    'radio,mcc,mnc,area,cell,unit,lon,lat,range,samples,changeable,created,updated,averageSignal',
    'LTE,310,260,10,20,0,-94.5000,39.1000,900,18,1,1700000000,1700001000,-82',
  ].join('\n'));

  assert.equal(detectPatternFormat(sheetRowsFromMatrix(datasetRows)), 'cell-reference-dataset');

  const analysis = processPatternOfLifeFiles([
    {
      name: 'cdr.csv',
      text: [
        'Date,Time,Direction,Call Type,Dialed Number,Duration,1st LAC,1st Cell ID,MCC,MNC',
        '01/02/2026,03:04:00,Outgoing,Voice,+15551234567,60,10,20,310,260',
      ].join('\n'),
    },
    {
      name: 'opencellid-sample.csv',
      text: datasetRows.map((row) => row.join(',')).join('\n'),
    },
  ], {}, { timeZone: 'UTC' });

  assert.equal(analysis.stats.openDatasetCells, 1);
  assert.equal(analysis.stats.enrichedEvents, 1);
  assert.equal(analysis.stats.unmappedCells, 0);
  assert.equal(analysis.cdr[0].geoSource, 'open-dataset');
  assert.equal(analysis.cellReferences[0].source, 'open-dataset');
});

test('WebMap ping text is parsed as precision location events', () => {
  const analysis = processPatternOfLifeFiles([
    {
      name: 'webmap.txt',
      text: 'WebMap Ping: Latitude: 39.069884, Longitude: -94.521914, Local Time Stamp: 01/21/2026 01:05:27 PM',
    },
  ], {}, { timeZone: 'UTC' });

  assert.equal(analysis.stats.timingAdvanceHits, 1);
  assert.equal(analysis.events[0].kind, 'precision_location');
  assert.equal(analysis.stats.geocodedEvents, 1);
});

test('ad-tech overlap candidates require real nearby pings inside the time window', () => {
  const analysis = processPatternOfLifeFiles([
    {
      name: 'cdr.csv',
      text: [
        'DateTime,LAT,LONG,Direction,Call Type,Dialed Number,Duration',
        '2026-01-02T03:00:00Z,39.1000,-94.5000,Outgoing,Voice,+15551234567,10',
        '2026-01-02T03:10:00Z,39.1001,-94.5001,Outgoing,Voice,+15551234567,10',
        '2026-01-02T03:20:00Z,39.1002,-94.5002,Outgoing,Voice,+15551234567,10',
      ].join('\n'),
    },
    {
      name: 'adtech.csv',
      text: [
        'advertising_id,latitude,longitude,timestamp,device_make',
        'dev-a,39.1000,-94.5000,2026-01-02T03:00:30Z,Apple',
        'dev-a,39.1001,-94.5001,2026-01-02T03:10:30Z,Apple',
        'dev-a,39.1002,-94.5002,2026-01-02T03:20:30Z,Apple',
        'dev-b,40.0000,-95.0000,2026-01-02T03:00:30Z,Other',
      ].join('\n'),
    },
  ], {}, { timeZone: 'UTC', overlapDistanceM: 100, overlapWindowSec: 120, overlapMinEvents: 3 });

  assert.equal(analysis.stats.adtechPings, 4);
  assert.equal(analysis.stats.candidateDevices, 1);
  assert.equal(analysis.adtech.candidates[0].deviceId, 'dev-a');
});

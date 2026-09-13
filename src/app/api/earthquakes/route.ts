
import { NextResponse } from 'next/server';
import { buildMetadata, collectionStatus, parseEpochMsOrNull, pointGeometry, sourceIdentity, updateSourceStatuses } from '@/lib/feed-integrity';

/**
 * OVERSEER — Earthquake Data API
 * Fetches real-time seismic events from USGS (last 24h, M2.5+)
 * No API key required
 */

export async function GET() {
  const collectedAt = new Date().toISOString();
  const source = sourceIdentity('usgs-earthquakes', 'USGS Earthquake Hazards Program', 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
  try {
    const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const status = collectionStatus({
        source,
        availability: res.status === 429 ? 'rate_limited' : 'error',
        dataState: 'unavailable',
        lastAttemptAt: collectedAt,
        errorCode: `HTTP_${res.status}`,
        message: `USGS returned HTTP ${res.status}.`,
      });
      updateSourceStatuses([status]);
      return NextResponse.json({ earthquakes: [], error: 'USGS unavailable', status: [status], timestamp: collectedAt }, { status: 503 });
    }

    const data = await res.json();
    const features = data.features || [];
    let rejected = 0;

    const earthquakes = features.map((f: any) => {
      const coords = f.geometry?.coordinates;
      const props = f.properties || {};
      const geometry = pointGeometry(coords?.[0], coords?.[1]);
      if (!geometry) {
        rejected++;
        return null;
      }
      const observedAt = parseEpochMsOrNull(props.time);
      return {
        id: f.id,
        lat: geometry.coordinates[1],
        lng: geometry.coordinates[0],
        depth: typeof coords?.[2] === 'number' && Number.isFinite(coords[2]) ? coords[2] : null,
        magnitude: props.mag,
        place: props.place,
        time: props.time,
        observedAt,
        url: props.url,
        tsunami: props.tsunami,
        type: props.type,
        felt: props.felt,
        alert: props.alert,
        evidence_kind: 'observation',
        integrity: buildMetadata({
          recordId: `usgs-${f.id}`,
          upstreamId: f.id,
          source,
          itemUrl: props.url,
          evidenceKind: 'observation',
          timing: { observedAt, sourceUpdatedAt: parseEpochMsOrNull(props.updated), collectedAt },
          location: {
            geometry,
            representativePoint: geometry.coordinates,
            precision: 'exact',
            relationship: 'event_location',
            resolutionMethod: 'source_coordinates',
            qualityFlags: [],
          },
        }),
      };
    }).filter(Boolean);
    const status = collectionStatus({
      source,
      availability: 'ok',
      dataState: earthquakes.length > 0 ? 'present' : 'empty',
      freshness: 'fresh',
      lastAttemptAt: collectedAt,
      lastSuccessfulFetchAt: collectedAt,
      receivedRecords: features.length,
      acceptedRecords: earthquakes.length,
      rejectedRecords: rejected,
      message: earthquakes.length > 0 ? 'USGS earthquake observations returned.' : 'No matching records returned.',
    });
    updateSourceStatuses([status]);

    return NextResponse.json({
      earthquakes,
      total: earthquakes.length,
      timestamp: collectedAt,
      collectedAt,
      dataMode: 'real',
      status: [status],
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('Earthquake fetch error:', error);
    const status = collectionStatus({
      source,
      availability: 'error',
      dataState: 'unavailable',
      lastAttemptAt: collectedAt,
      errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
      message: 'USGS earthquake feed unavailable.',
    });
    updateSourceStatuses([status]);
    return NextResponse.json({ earthquakes: [], error: 'Failed to fetch earthquake data', status: [status], timestamp: collectedAt }, { status: 500 });
  }
}

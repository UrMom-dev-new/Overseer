
import { NextResponse } from 'next/server';
import { collectionStatus, nowIso, sourceIdentity, updateSourceStatuses, type SourceCollectionStatus } from '@/lib/feed-integrity';

/**
 * OVERSEER — Space Weather API
 * Fetches real-time solar activity from NOAA Space Weather Prediction Center
 * FREE — No API key required
 * Data: Kp index (geomagnetic), solar flares, CME alerts
 */

export async function GET() {
  const collectedAt = nowIso();
  try {
    const [kpRes, alertsRes, flareRes] = await Promise.allSettled([
      fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', {
        signal: AbortSignal.timeout(8000),
      }).then(r => r.json()),
      fetch('https://services.swpc.noaa.gov/products/alerts.json', {
        signal: AbortSignal.timeout(8000),
      }).then(r => r.json()),
      fetch('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', {
        signal: AbortSignal.timeout(8000),
      }).then(r => r.json()),
    ]);

    // Latest Kp index (geomagnetic storm indicator)
    let kpIndex: number | null = null;
    let kpTimestamp: string | null = null;
    if (kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) && kpRes.value.length > 0) {
      const latest = kpRes.value[kpRes.value.length - 1];
      const parsed = parseFloat(latest.kp_index || latest.Kp);
      kpIndex = Number.isFinite(parsed) ? parsed : null;
      kpTimestamp = latest.time_tag || null;
    }

    // Storm level from Kp
    let stormLevel = kpIndex === null ? 'Unknown' : 'Quiet';
    let stormColor = kpIndex === null ? '#555' : '#00E676';
    if (kpIndex !== null && kpIndex >= 8) { stormLevel = 'Extreme (G5)'; stormColor = '#FF1744'; }
    else if (kpIndex !== null && kpIndex >= 7) { stormLevel = 'Severe (G4)'; stormColor = '#FF3D3D'; }
    else if (kpIndex !== null && kpIndex >= 6) { stormLevel = 'Strong (G3)'; stormColor = '#FF9500'; }
    else if (kpIndex !== null && kpIndex >= 5) { stormLevel = 'Moderate (G2)'; stormColor = '#FFD700'; }
    else if (kpIndex !== null && kpIndex >= 4) { stormLevel = 'Minor (G1)'; stormColor = '#FFD700'; }
    else if (kpIndex !== null && kpIndex >= 3) { stormLevel = 'Unsettled'; stormColor = '#D4AF37'; }

    // Recent alerts
    const alerts: any[] = [];
    if (alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value)) {
      for (const alert of alertsRes.value.slice(0, 10)) {
        alerts.push({
          id: alert.product_id || `noaa-alert-${alert.issue_datetime || alert.message?.slice(0, 30) || alerts.length}`,
          issue_datetime: alert.issue_datetime,
          message: (alert.message || '').substring(0, 200),
        });
      }
    }

    // Recent solar flares
    const flares: any[] = [];
    if (flareRes.status === 'fulfilled' && Array.isArray(flareRes.value)) {
      for (const flare of flareRes.value.slice(0, 5)) {
        if (!flare.max_class) continue;
        flares.push({
          class: flare.max_class,
          begin: flare.begin_time,
          peak: flare.max_time,
          end: flare.end_time,
        });
      }
    }

    const status: SourceCollectionStatus[] = [
      collectionStatus({
        source: sourceIdentity('noaa-swpc-kp', 'NOAA SWPC planetary K index', 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json'),
        availability: kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) ? 'ok' : 'error',
        dataState: kpIndex === null ? 'empty' : 'present',
        freshness: kpIndex === null ? 'unknown' : 'fresh',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) ? collectedAt : null,
        receivedRecords: kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) ? kpRes.value.length : 0,
        acceptedRecords: kpIndex === null ? 0 : 1,
        message: kpIndex === null ? 'NOAA SWPC Kp index unavailable or empty.' : 'NOAA SWPC Kp index returned.',
      }),
      collectionStatus({
        source: sourceIdentity('noaa-swpc-alerts', 'NOAA SWPC alerts', 'https://services.swpc.noaa.gov/products/alerts.json'),
        availability: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value) ? 'ok' : 'error',
        dataState: alerts.length > 0 ? 'present' : 'empty',
        freshness: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value) ? 'fresh' : 'unknown',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value) ? collectedAt : null,
        receivedRecords: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value) ? alertsRes.value.length : 0,
        acceptedRecords: alerts.length,
        message: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value) ? 'NOAA SWPC alerts returned.' : 'NOAA SWPC alerts unavailable; alert stream omitted.',
      }),
      collectionStatus({
        source: sourceIdentity('noaa-swpc-xray-flares', 'NOAA SWPC X-ray flares', 'https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json'),
        availability: flareRes.status === 'fulfilled' && Array.isArray(flareRes.value) ? 'ok' : 'error',
        dataState: flares.length > 0 ? 'present' : 'empty',
        freshness: flareRes.status === 'fulfilled' && Array.isArray(flareRes.value) ? 'fresh' : 'unknown',
        lastAttemptAt: collectedAt,
        lastSuccessfulFetchAt: flareRes.status === 'fulfilled' && Array.isArray(flareRes.value) ? collectedAt : null,
        receivedRecords: flareRes.status === 'fulfilled' && Array.isArray(flareRes.value) ? flareRes.value.length : 0,
        acceptedRecords: flares.length,
        message: flareRes.status === 'fulfilled' && Array.isArray(flareRes.value) ? 'NOAA SWPC X-ray flare records returned.' : 'NOAA SWPC X-ray flare stream unavailable.',
      }),
    ];
    updateSourceStatuses(status);

    return NextResponse.json({
      kp_index: kpIndex,
      storm_level: stormLevel,
      storm_color: stormColor,
      kp_timestamp: kpTimestamp,
      alerts,
      solar_flares: flares,
      status,
      timestamp: collectedAt,
    });
  } catch (error) {
    console.error('Space Weather API error:', error);
    const status = collectionStatus({
      source: sourceIdentity('noaa-swpc', 'NOAA SWPC', 'https://services.swpc.noaa.gov/'),
      availability: 'error',
      dataState: 'unavailable',
      lastAttemptAt: collectedAt,
      errorCode: error instanceof Error ? error.name : 'FETCH_ERROR',
      message: 'NOAA SWPC source collection failed; space-weather stream omitted.',
    });
    updateSourceStatuses([status]);
    return NextResponse.json({
      kp_index: null, storm_level: 'Unknown', storm_color: '#555',
      alerts: [], solar_flares: [], status: [status], error: 'Failed to fetch space weather data',
    }, { status: 500 });
  }
}

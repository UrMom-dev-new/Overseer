
import { NextResponse } from 'next/server';

/**
 * OVERSEER — Space Weather API
 * Fetches real-time solar activity from NOAA Space Weather Prediction Center
 * FREE — No API key required
 * Data: Kp index (geomagnetic), solar flares, CME alerts
 */

export async function GET() {
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

    return NextResponse.json({
      kp_index: kpIndex,
      storm_level: stormLevel,
      storm_color: stormColor,
      kp_timestamp: kpTimestamp,
      alerts,
      solar_flares: flares,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Space Weather API error:', error);
    return NextResponse.json({
      kp_index: null, storm_level: 'Unknown', storm_color: '#555',
      alerts: [], solar_flares: [], error: 'Failed to fetch space weather data',
    }, { status: 500 });
  }
}

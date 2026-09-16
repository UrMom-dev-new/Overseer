import { NextResponse } from 'next/server';
import { buildScmSupplierOverlay, type ScmSourceCollection } from '@/lib/scm-suppliers';
import { GET as getEarthquakes } from '../earthquakes/route';
import { GET as getFires } from '../fires/route';
import { GET as getGdelt } from '../gdelt/route';

/**
 * OVERSEER — SCM Supplier Risk Overlay
 * Reports source-backed exposure indicators near static supplier reference
 * points. Missing streams are reported unavailable and omitted; they are never
 * converted into NORMAL/CRITICAL defaults.
 */

export async function GET() {
  const collectedAt = new Date().toISOString();
  const payload = await buildScmSupplierOverlay({
    earthquakes: () => collectFromRoute('USGS earthquakes', getEarthquakes, 'earthquakes'),
    fires: () => collectFromRoute('Fire/thermal detections', getFires, 'fires'),
    gdelt: () => collectFromRoute('GDELT geolocated news mentions', getGdelt, 'events'),
  }, collectedAt);

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function collectFromRoute(
  source: string,
  getRoute: () => Promise<Response>,
  recordField: string,
): Promise<ScmSourceCollection> {
  const response = await getRoute();
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const records = payload && Array.isArray(payload[recordField]) ? payload[recordField] as unknown[] : [];
  const statusMessage = firstStatusMessage(payload);

  if (!response.ok) {
    return {
      source,
      availability: 'error',
      dataState: 'unavailable',
      message: statusMessage || `Local ${recordField} collector returned HTTP ${response.status}; stream omitted.`,
      records: [],
    };
  }

  if (!payload || !Array.isArray(payload[recordField])) {
    return {
      source,
      availability: 'error',
      dataState: 'unavailable',
      message: `Local ${recordField} collector returned no ${recordField} array; stream omitted.`,
      records: [],
    };
  }

  return {
    source,
    availability: 'ok',
    dataState: records.length > 0 ? 'present' : 'empty',
    message: statusMessage || (records.length > 0 ? `${source} returned.` : `${source} returned no records.`),
    records,
  };
}

function firstStatusMessage(payload: Record<string, unknown> | null): string | null {
  const statuses = Array.isArray(payload?.status) ? payload.status : [];
  for (const status of statuses) {
    if (status && typeof status === 'object' && typeof (status as { message?: unknown }).message === 'string') {
      return (status as { message: string }).message;
    }
  }
  return null;
}

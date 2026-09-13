const baseUrl = (process.env.OVERSEER_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const timeoutMs = Number(process.env.OVERSEER_VERIFY_TIMEOUT_MS || 20_000);

const routes = [
  { id: 'earthquakes', path: '/api/earthquakes', arrays: ['earthquakes'] },
  { id: 'news', path: '/api/news', arrays: ['news'] },
  { id: 'weather', path: '/api/weather', arrays: ['events', 'weather_events'] },
  { id: 'fires', path: '/api/fires', arrays: ['fires', 'events'] },
  { id: 'gdelt', path: '/api/gdelt', arrays: ['events'] },
  { id: 'flights', path: '/api/flights', arrays: ['commercial_flights', 'military_flights', 'private_flights', 'private_jets'] },
  { id: 'satellites', path: '/api/satellites', arrays: ['satellites'] },
  { id: 'maritime', path: '/api/maritime', arrays: ['ships', 'ports', 'chokepoints'] },
  { id: 'markets', path: '/api/markets', arrays: ['quotes', 'assets'] },
  { id: 'space-weather', path: '/api/space-weather', arrays: ['alerts'] },
  { id: 'sources', path: '/api/sources', arrays: ['capabilities'] },
];

function timeoutSignal() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function countArrays(payload, keys) {
  if (!payload || typeof payload !== 'object') return 0;
  let count = 0;
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) count += value.length;
  }
  return count;
}

function sourceStatuses(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.status)) return payload.status;
  if (Array.isArray(payload.source_status)) return payload.source_status;
  return [];
}

async function checkRoute(route) {
  const { signal, cancel } = timeoutSignal();
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${route.path}`, { signal, cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let payload = null;
    let parseError = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    const statusArray = sourceStatuses(payload);
    const acceptedFromArrays = countArrays(payload, route.arrays);
    const acceptedFromStatus = statusArray.reduce((sum, status) => {
      const value = typeof status.acceptedRecords === 'number' ? status.acceptedRecords : status.accepted;
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
    return {
      id: route.id,
      path: route.path,
      ok: response.ok && !parseError,
      httpStatus: response.status,
      contentType,
      durationMs: Date.now() - startedAt,
      parseError,
      acceptedCount: Math.max(acceptedFromArrays, acceptedFromStatus),
      sourceStatus: statusArray.map((status) => ({
        providerId: status.source?.providerId || status.provider,
        availability: status.availability,
        dataState: status.dataState || null,
        acceptedRecords: typeof status.acceptedRecords === 'number' ? status.acceptedRecords : status.accepted,
        rejectedRecords: status.rejectedRecords ?? null,
        message: status.message,
      })),
      message: payload && typeof payload === 'object' ? payload.error || payload.message || null : null,
    };
  } catch (error) {
    return {
      id: route.id,
      path: route.path,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    cancel();
  }
}

const results = [];
for (const route of routes) {
  results.push(await checkRoute(route));
}

const report = {
  testedAt: new Date().toISOString(),
  baseUrl,
  platform: `${process.platform}-${process.arch}`,
  results,
};

console.log(JSON.stringify(report, null, 2));

const appReachable = results.some((result) => result.path === '/api/sources' && result.ok);
if (!appReachable) process.exit(1);

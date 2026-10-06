import { createRansomwareCollector } from '../../../lib/feed-integrity/ransomware';
import { updateSourceStatuses } from '../../../lib/feed-integrity/status-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const collector = createRansomwareCollector();

export async function GET() {
  const { payload, httpStatus } = await collector.get();
  updateSourceStatuses(payload.status);
  const headers: Record<string, string> = { 'Cache-Control': 'no-store, max-age=0' };
  const retryAt = payload.status[0].nextRetryAt;
  if (retryAt) headers['Retry-After'] = String(Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000)));
  return Response.json(payload, { status: httpStatus, headers });
}

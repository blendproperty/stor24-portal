import { timingSafeEqual } from 'node:crypto';
import { readOperationsAlerts } from '@/lib/operations-alerts';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const key = process.env.STOR24_ALERT_CONFIG_KEY || '';
  const supplied = request.headers.get('authorization') || '';
  const expected = `Bearer ${key}`;
  if (!/^[0-9a-f]{64}$/i.test(key) || !/^Bearer [0-9a-f]{64}$/i.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return Response.json({ error: 'Unauthorised.' }, { status: 401, headers });
  const organisationId = process.env.STOR24_ALERT_ORGANISATION_ID;
  if (!organisationId) return Response.json({ error: 'Configuration unavailable.' }, { status: 503, headers });
  try {
    const data = await readOperationsAlerts(organisationId);
    if (!data.recipients.length) return Response.json({ error: 'Configuration unavailable.' }, { status: 503, headers });
    return Response.json({ data }, { headers });
  } catch { return Response.json({ error: 'Configuration unavailable.' }, { status: 503, headers }); }
}

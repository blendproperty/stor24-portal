import { authErrorResponse, requireOwner } from '@/lib/auth-guards';
import { rateLimit, sameOrigin } from '@/lib/request-security';
import { readOperationsAlerts, saveOperationsAlerts } from '@/lib/operations-alerts';
import { validateAlertRecipients } from '@/lib/operations-alert-policy.mjs';

const headers = { 'Cache-Control': 'no-store' };
export async function GET() {
  try {
    const auth = await requireOwner();
    if (process.env.STOR24_ALERT_ORGANISATION_ID && process.env.STOR24_ALERT_ORGANISATION_ID !== auth.user.organisationId) throw Error('FORBIDDEN');
    return Response.json({ data: await readOperationsAlerts(auth.user.organisationId) }, { headers });
  }
  catch (error) { const response = authErrorResponse(error); response.headers.set('Cache-Control', 'no-store'); return response; }
}
export async function PUT(request: Request) {
  try {
    const auth = await requireOwner();
    if (process.env.STOR24_ALERT_ORGANISATION_ID && process.env.STOR24_ALERT_ORGANISATION_ID !== auth.user.organisationId) throw Error('FORBIDDEN');
    if (!sameOrigin(request)) return Response.json({ error: { message: 'Request rejected.' } }, { status: 403, headers });
    if (await rateLimit(`operations-alerts:${auth.user.id}`, 15, 60_000)) return Response.json({ error: { message: 'Please wait before saving again.' } }, { status: 429, headers });
    const text = await request.text();
    if (text.length > 24_000) return Response.json({ error: { message: 'Recipient list is too large.' } }, { status: 413, headers });
    let input, recipients;
    try {
      input = JSON.parse(text);
      if (!input || Object.keys(input).some(k => !['recipients', 'revision'].includes(k)) || !(input.revision === null || (typeof input.revision === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.revision)))) throw new Error('Invalid saved version. Reload the list.');
      recipients = validateAlertRecipients(input.recipients);
    } catch (error) { return Response.json({ error: { message: error instanceof SyntaxError ? 'Invalid recipient details.' : error instanceof Error ? error.message : 'Invalid recipient details.' } }, { status: 422, headers }); }
    const data = await saveOperationsAlerts(auth.user.organisationId, auth.user.id, recipients, input.revision);
    return Response.json({ data }, { headers });
  } catch (error) {
    if (error instanceof Error && (error.message === 'ALERT_CONFIG_CONFLICT' || ('code' in error && error.code === 'P2002'))) return Response.json({ error: { message: 'Someone else changed this list. Reload before saving.' } }, { status: 409, headers });
    const response = authErrorResponse(error); response.headers.set('Cache-Control', 'no-store'); return response;
  }
}

import { authErrorResponse, requireOwner } from '@/lib/auth-guards';
import { operationsDiagnostics } from '@/lib/operations-diagnostics';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const auth = await requireOwner();
    // Host/monitor evidence belongs only to the fixed monitored organisation.
    if (!process.env.STOR24_ALERT_ORGANISATION_ID || process.env.STOR24_ALERT_ORGANISATION_ID !== auth.user.organisationId) throw new Error('FORBIDDEN');
    return Response.json({ data: await operationsDiagnostics(auth.user.organisationId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { const response = authErrorResponse(error); response.headers.set('Cache-Control', 'private, no-store'); return response; }
}

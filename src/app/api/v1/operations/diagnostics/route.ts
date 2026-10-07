import { guardDlpTransfer } from "@/lib/dlp-transfer-service";
import { authErrorResponse, requireOwner } from '@/lib/auth-guards';
import { operationsDiagnostics } from '@/lib/operations-diagnostics';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const auth = await requireOwner();
    // Host/monitor evidence belongs only to the fixed monitored organisation.
    if (!process.env.STOR24_ALERT_ORGANISATION_ID || process.env.STOR24_ALERT_ORGANISATION_ID !== auth.user.organisationId) throw new Error('FORBIDDEN');
    const data = await operationsDiagnostics(auth.user.organisationId);
    if (request && new URL(request.url).searchParams.get("export") === "json") {
      const content = JSON.stringify({ ...data, exportedAt: new Date().toISOString(), note: "Operational evidence only. Provider acceptance is not recipient delivery; local backups are not independent recovery." }, null, 2);
      await requireOwner();
      const headers = await guardDlpTransfer({ organisationId: auth.user.organisationId, actorId: auth.user.id, resourceId: "operations-diagnostics", channel: "DOWNLOAD", classification: "restricted", content });
      return new Response(content, { headers: { ...headers, "content-type": "application/json", "content-disposition": 'attachment; filename="stor24-troubleshooting.json"' } });
    }
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { const response = authErrorResponse(error); response.headers.set('Cache-Control', 'private, no-store'); return response; }
}

import { db } from "@/lib/db";
import { authErrorResponse } from "@/lib/auth-guards";
import { requireFacility, requirePermissionScope } from "@/lib/scope";
import { requireLeasingCustomer } from "@/lib/leasing-service";
import { sameOrigin } from "@/lib/request-security";
import { sendWhatsAppTemplate, type WhatsAppMessageType } from "@/lib/whatsapp";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
    const actor = await requirePermissionScope("operations.manage");
    const { logId } = await request.json() as { logId?: string };
    const log = logId ? await db.communicationLog.findFirst({ where: { id: logId, organisationId: actor.organisationId, channel: "WHATSAPP", status: "FAILED" } }) : null;
    if (!log?.customerId || !log.messageType || !log.metadata || typeof log.metadata !== "object" || Array.isArray(log.metadata)) return Response.json({ error: "Retry is not available for this message." }, { status: 404 });
    if (log.facilityId) await requireFacility(actor, log.facilityId);
    const customer = await requireLeasingCustomer(actor, log.customerId);
    if (!customer.phone) return Response.json({ error: "Retry is not available for this message." }, { status: 404 });
    const metadata = log.metadata as Record<string, unknown>;
    const variables = metadata.variables && typeof metadata.variables === "object" && !Array.isArray(metadata.variables) ? metadata.variables as Record<string, string> : {};
    const result = await sendWhatsAppTemplate({ organisationId: log.organisationId, facilityId: log.facilityId ?? undefined, customerId: customer.id, recipient: customer.phone, consent: customer.communicationConsent, messageType: log.messageType as WhatsAppMessageType, variables, idempotencyKey: `${log.idempotencyKey}:retry:${log.attempts + 1}`, allowWhenAutomationDisabled: true });
    await db.communicationLog.update({ where: { id: log.id }, data: { attempts: { increment: 1 }, nextRetryAt: null } });
    return Response.json({ data: result });
  } catch (error) { return authErrorResponse(error instanceof Error && error.message === "FACILITY_FORBIDDEN" ? new Error("FORBIDDEN") : error); }
}

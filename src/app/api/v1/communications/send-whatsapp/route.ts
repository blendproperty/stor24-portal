import { z } from "zod";
import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { sendWhatsAppTemplate, WHATSAPP_TEMPLATE_ENV } from "@/lib/whatsapp";

const schema = z.object({ customerId: z.string().min(1), facilityId: z.string().min(1), messageType: z.enum(Object.keys(WHATSAPP_TEMPLATE_ENV) as [keyof typeof WHATSAPP_TEMPLATE_ENV, ...(keyof typeof WHATSAPP_TEMPLATE_ENV)[]]), variables: z.record(z.string(), z.string().max(500)), idempotencyKey: z.string().min(16).max(160) });

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
    const actor = await requirePermission("operations.manage");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Check the WhatsApp message details." }, { status: 422 });
    await requirePermission("operations.manage", parsed.data.facilityId);
    const customer = await db.customer.findFirst({ where: { id: parsed.data.customerId, organisationId: actor.organisationId }, select: { id: true, phone: true, communicationConsent: true } });
    if (!customer?.phone) return Response.json({ error: "Customer phone number not found." }, { status: 404 });
    const result = await sendWhatsAppTemplate({ organisationId: actor.organisationId, facilityId: parsed.data.facilityId, customerId: customer.id, recipient: customer.phone, consent: customer.communicationConsent, messageType: parsed.data.messageType, variables: parsed.data.variables, idempotencyKey: parsed.data.idempotencyKey, allowWhenAutomationDisabled: true });
    if (!result.ok) return Response.json({ error: result.code }, { status: result.code === "CONSENT_REQUIRED" ? 409 : 502 });
    await db.auditEvent.create({ data: { organisationId: actor.organisationId, facilityId: parsed.data.facilityId, actorId: actor.user.id, action: "communication.whatsapp.sent", entityType: "Customer", entityId: customer.id, after: { messageType: parsed.data.messageType, communicationLogId: result.logId } } });
    return Response.json({ data: { logId: result.logId } }, { status: 202 });
  } catch (error) { return authErrorResponse(error); }
}

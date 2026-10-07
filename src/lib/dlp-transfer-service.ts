import { currentRoleAccess } from "@/lib/current-role-access";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { dlpRecipientHash, rateLimit } from "@/lib/request-security";
import { DLP_POLICY_VERSION, inspectReportExport, dlpPrivateHeaders } from "@/lib/dlp-policy";

export type DlpContext = { organisationId: string; facilityId?: string; actorId?: string; resourceId: string; approvedRecipient?: string; personalDataExport?: { facilityIds: string[]; unrestrictedFacilities: boolean } };
export type DlpTransfer = DlpContext & { channel: "EMAIL" | "SMS" | "WHATSAPP" | "DOWNLOAD"; classification: "confidential" | "restricted"; content?: string; byteLength?: number; recipient?: string };
export async function guardDlpTransfer(input: DlpTransfer) {
  if (!input.organisationId || !input.resourceId) throw new Error("DLP_CONTEXT_REQUIRED");
  const requestId = randomUUID();
  const reasons = new Set<string>();
  const bytes = input.byteLength ?? new TextEncoder().encode(input.content ?? "").byteLength;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 20 * 1024 * 1024) reasons.add("TRANSFER_SIZE_LIMIT");
  if (input.content) for (const reason of inspectReportExport("rent-roll", [{ customer: input.content }]).reasons) reasons.add(reason);
  if (input.content && ["AUTH_SECRET", "PUBLIC_BOOKING_API_KEY", "RESEND_API_KEY", "SENDGRID_API_KEY", "TWILIO_AUTH_TOKEN", "INTEGRATION_CONFIG_ENCRYPTION_KEY", "IDENTITY_DOCUMENT_ENCRYPTION_KEY"].some(key => { const secret = process.env[key]; return secret && secret.length >= 16 && input.content!.includes(secret); })) reasons.add("CONFIGURED_CREDENTIAL");
  if (input.channel !== "DOWNLOAD" && (!input.recipient || !input.approvedRecipient || input.recipient.trim().toLowerCase() !== input.approvedRecipient.trim().toLowerCase())) reasons.add("RECIPIENT_MISMATCH");
  // Scope the shared counter to the actual actor or destination. It survives
  // restarts and correlates split transfers without storing raw recipients.
  const principal = input.actorId ?? (input.recipient ? dlpRecipientHash(input.recipient.trim().toLowerCase()) : input.resourceId);
  if (await rateLimit(`dlp:${input.organisationId}:${input.channel}:${principal}`, 60, 3600000)) reasons.add("TRANSFER_RATE_LIMIT");
  if (input.personalDataExport) {
    const actor = input.actorId ? await db.user.findFirst({ where: { id: input.actorId, organisationId: input.organisationId, active: true }, include: { roleAssignments: { include: { role: true } } } }) : null;
    const access = currentRoleAccess(actor?.roleAssignments ?? [], "data.personal_export");
    if (!access.allowed || (access.allowedFacilityIds !== null && (input.personalDataExport.unrestrictedFacilities || input.personalDataExport.facilityIds.length === 0 || !input.personalDataExport.facilityIds.every(id => access.allowedFacilityIds!.includes(id))))) reasons.add("PERSONAL_EXPORT_PERMISSION_REQUIRED");
  }
  const allowed = reasons.size === 0;
  await db.auditEvent.create({ data: { organisationId: input.organisationId, facilityId: input.facilityId, actorId: input.actorId,
    entityType: "DlpTransfer", entityId: input.resourceId, requestId, action: allowed ? "dlp.transfer.allowed" : "dlp.transfer.blocked",
    after: { policyVersion: DLP_POLICY_VERSION, classification: input.classification, channel: input.channel, personalDataExport: !!input.personalDataExport, byteCount: bytes, reasons: [...reasons].sort(), ...(input.recipient ? { recipientHash: dlpRecipientHash(input.recipient.trim().toLowerCase()) } : {}) },
  } });
  if (!allowed) throw new Error(reasons.has("PERSONAL_EXPORT_PERMISSION_REQUIRED") ? "PERSONAL_EXPORT_FORBIDDEN" : "DLP_TRANSFER_BLOCKED");
  return { ...dlpPrivateHeaders, "x-stor24-data-classification": input.classification, "x-stor24-dlp-policy": DLP_POLICY_VERSION, "x-request-id": requestId };
}

/** Call only after the handler has authorised the exact resource and recipient. */
export async function protectDlpResponse(response: Response, context: DlpContext, classification: "confidential" | "restricted" = "restricted") {
  if (!response.ok) return response;
  const body = await response.arrayBuffer();
  const type = response.headers.get("content-type") ?? "";
  const headers = await guardDlpTransfer({ ...context, channel: "DOWNLOAD", classification, byteLength: body.byteLength,
    ...(type.includes("csv") || type.includes("html") ? { content: new TextDecoder().decode(body) } : {}) });
  const secured = new Response(body, { status: response.status, headers: response.headers });
  for (const [key, value] of Object.entries(headers)) secured.headers.set(key, value);
  return secured;
}

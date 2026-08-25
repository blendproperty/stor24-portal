import { db } from "@/lib/db";
import { privacyHash } from "@/lib/request-security";
import { formEntries, formObject, validTwilioSignature } from "@/lib/twilio-webhooks";
import { recordWhatsAppOptOut } from "@/lib/whatsapp";

const OPT_OUT = /^(stop|unsubscribe|cancel|end|quit)$/i;

export async function POST(request: Request) {
  const entries = formEntries(await request.formData());
  if (!validTwilioSignature(request, entries, "/api/webhooks/twilio/inbound")) return Response.json({ error: "Invalid signature." }, { status: 403 });
  const payload = formObject(entries);
  const externalEventId = payload.MessageSid || payload.SmsMessageSid;
  const from = (payload.From || "").replace(/^whatsapp:/, "");
  const body = (payload.Body || "").trim();
  if (!externalEventId || !from) return Response.json({ error: "Invalid inbound message." }, { status: 422 });
  const recipientHash = privacyHash(from);
  const recent = await db.communicationLog.findFirst({ where: { channel: "WHATSAPP", recipientHash, direction: "OUTBOUND" }, orderBy: { queuedAt: "desc" } });
  if (!recent?.customerId) return new Response("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });

  await db.$transaction(async (tx) => {
    await tx.webhookInbox.upsert({
      where: { organisationId_provider_externalEventId: { organisationId: recent.organisationId, provider: "TWILIO", externalEventId } },
      create: { organisationId: recent.organisationId, facilityId: recent.facilityId, provider: "TWILIO", eventType: "WHATSAPP_INBOUND", externalEventId, payload: { ...payload, From: recipientHash }, status: "SUCCEEDED", attempts: 1, processedAt: new Date() },
      update: {},
    });
    await tx.communicationLog.upsert({ where: { idempotencyKey: `twilio-inbound:${externalEventId}` }, create: { organisationId: recent.organisationId, facilityId: recent.facilityId, customerId: recent.customerId, channel: "WHATSAPP", direction: "INBOUND", messageType: OPT_OUT.test(body) ? "OPT_OUT" : "CUSTOMER_REPLY", recipientHash, provider: "twilio", providerRef: externalEventId, status: "SUCCEEDED", idempotencyKey: `twilio-inbound:${externalEventId}`, deliveredAt: new Date(), metadata: { body } }, update: {} });
    await tx.task.create({ data: { organisationId: recent.organisationId, facilityId: recent.facilityId, customerId: recent.customerId, title: OPT_OUT.test(body) ? "Customer opted out of WhatsApp" : "New customer WhatsApp reply", description: OPT_OUT.test(body) ? "WhatsApp consent was revoked automatically." : body.slice(0, 1000), priority: OPT_OUT.test(body) ? "HIGH" : "NORMAL" } });
  });
  if (OPT_OUT.test(body)) await recordWhatsAppOptOut(recent.customerId);
  return new Response("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });
}

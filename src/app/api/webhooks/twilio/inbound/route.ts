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
  const optedOut = OPT_OUT.test(body);
  const recent = await db.communicationLog.findFirst({ where: { channel: "WHATSAPP", recipientHash, direction: "OUTBOUND" }, orderBy: { queuedAt: "desc" } });
  if (!recent?.customerId) return new Response("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });

  const { customerId } = recent;
  await db.$transaction(async (tx) => {
    const claimed = await tx.webhookInbox.createMany({
      data: { organisationId: recent.organisationId, facilityId: recent.facilityId, provider: "TWILIO", eventType: "WHATSAPP_INBOUND", externalEventId, payload: { ...payload, From: recipientHash }, status: "SUCCEEDED", attempts: 1, processedAt: new Date() },
      skipDuplicates: true,
    });
    if (!claimed.count) return;
    await tx.communicationLog.upsert({ where: { idempotencyKey: `twilio-inbound:${externalEventId}` }, create: { organisationId: recent.organisationId, facilityId: recent.facilityId, customerId: recent.customerId, channel: "WHATSAPP", direction: "INBOUND", messageType: optedOut ? "OPT_OUT" : "CUSTOMER_REPLY", recipientHash, provider: "twilio", providerRef: externalEventId, status: "SUCCEEDED", idempotencyKey: `twilio-inbound:${externalEventId}`, deliveredAt: new Date(), metadata: { body } }, update: {} });
    await tx.task.create({ data: { organisationId: recent.organisationId, facilityId: recent.facilityId, customerId: recent.customerId, title: optedOut ? "Customer opted out of WhatsApp" : "New customer WhatsApp reply", description: optedOut ? "WhatsApp consent was revoked automatically." : body.slice(0, 1000), priority: optedOut ? "HIGH" : "NORMAL" } });
    if (optedOut) await recordWhatsAppOptOut(tx, customerId);
  });
  return new Response("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });
}

import { db } from "@/lib/db";
import { formEntries, formObject, validTwilioSignature } from "@/lib/twilio-webhooks";

export async function POST(request: Request) {
  const entries = formEntries(await request.formData());
  if (!validTwilioSignature(request, entries, "/api/webhooks/twilio/status")) return Response.json({ error: "Invalid signature." }, { status: 403 });
  const payload = formObject(entries);
  const providerRef = payload.MessageSid || payload.SmsSid;
  if (!providerRef) return Response.json({ error: "MessageSid is required." }, { status: 422 });
  const log = await db.communicationLog.findFirst({ where: { provider: "twilio", providerRef } });
  if (!log) return new Response(null, { status: 204 });

  const status = (payload.MessageStatus || payload.SmsStatus || "").toLowerCase();
  const isRead = status === "read" || payload.EventType?.toUpperCase() === "READ";
  const isDelivered = status === "delivered" || isRead;
  const isFailed = status === "failed" || status === "undelivered";
  await db.$transaction(async (tx) => {
    await tx.webhookInbox.upsert({
      where: { organisationId_provider_externalEventId: { organisationId: log.organisationId, provider: "TWILIO", externalEventId: `${providerRef}:${isRead ? "read" : status}` } },
      create: { organisationId: log.organisationId, facilityId: log.facilityId, provider: "TWILIO", eventType: "MESSAGE_STATUS", externalEventId: `${providerRef}:${isRead ? "read" : status}`, payload, status: "SUCCEEDED", attempts: 1, processedAt: new Date() },
      update: {},
    });
    await tx.communicationLog.update({ where: { id: log.id }, data: {
      status: isFailed ? "FAILED" : isDelivered ? "SUCCEEDED" : "PROCESSING",
      sentAt: ["sent", "delivered", "read"].includes(status) || isRead ? (log.sentAt ?? new Date()) : undefined,
      deliveredAt: isDelivered ? (log.deliveredAt ?? new Date()) : undefined,
      readAt: isRead ? (log.readAt ?? new Date()) : undefined,
      failedAt: isFailed ? new Date() : undefined,
      failureCode: isFailed ? (payload.ErrorCode || "DELIVERY_FAILED") : undefined,
      failureMessage: isFailed ? (payload.ChannelStatusMessage || "Twilio could not deliver the message.") : undefined,
      nextRetryAt: isFailed && log.attempts < 3 ? new Date(Date.now() + 5 * 60_000) : undefined,
    } });
    if (isFailed) await tx.task.create({ data: { organisationId: log.organisationId, facilityId: log.facilityId, customerId: log.customerId, title: "WhatsApp delivery failed", description: `Review communication ${log.id}. Twilio error ${payload.ErrorCode || "unknown"}.`, priority: log.attempts >= 3 ? "HIGH" : "NORMAL" } });
  });
  return new Response(null, { status: 204 });
}

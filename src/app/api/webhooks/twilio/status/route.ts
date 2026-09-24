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
  const eventKey = { organisationId: log.organisationId, provider: "TWILIO", externalEventId: `${providerRef}:${isRead ? "read" : status}` };
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CommunicationLog" WHERE "id" = ${log.id} FOR UPDATE`;
      const current = await tx.communicationLog.findUniqueOrThrow({ where: { id: log.id } });
      // Claim the event before its effects; upsert would still repeat the task
      // and log updates when a signed callback is retried.
      await tx.webhookInbox.create({
        data: { ...eventKey, facilityId: log.facilityId, eventType: "MESSAGE_STATUS", payload, status: "SUCCEEDED", attempts: 1, processedAt: new Date() },
      });
      // Callbacks can arrive out of order. Keep every event in the inbox, but
      // never let an earlier/unknown state erase confirmed delivery or failure.
      if (!isDelivered) {
        // Legacy SMS logs use SUCCEEDED for API acceptance, not delivery.
        if (current.deliveredAt || current.readAt) return;
        if (isFailed && current.failedAt) return;
        if (!isFailed && (current.status === "FAILED" || current.failedAt || !["accepted", "scheduled", "queued", "sending", "sent"].includes(status))) return;
      }
      await tx.communicationLog.update({ where: { id: log.id }, data: {
        status: isFailed ? "FAILED" : isDelivered ? "SUCCEEDED" : "PROCESSING",
        sentAt: ["sent", "delivered", "read"].includes(status) || isRead ? (current.sentAt ?? new Date()) : undefined,
        deliveredAt: isDelivered ? (current.deliveredAt ?? new Date()) : undefined,
        readAt: isRead ? (current.readAt ?? new Date()) : undefined,
        failedAt: isFailed ? new Date() : isDelivered ? null : undefined,
        failureCode: isFailed ? (payload.ErrorCode || "DELIVERY_FAILED") : isDelivered ? null : undefined,
        failureMessage: isFailed ? (payload.ChannelStatusMessage || "Twilio could not deliver the message.") : isDelivered ? null : undefined,
        nextRetryAt: isFailed ? (current.attempts < 3 ? new Date(Date.now() + 5 * 60_000) : null) : isDelivered ? null : undefined,
      } });
      if (isFailed) await tx.task.create({ data: { organisationId: current.organisationId, facilityId: current.facilityId, customerId: current.customerId, title: `${current.channel === "SMS" ? "SMS" : "WhatsApp"} delivery failed`, description: `Review communication ${current.id}. Twilio error ${payload.ErrorCode || "unknown"}.`, priority: current.attempts >= 3 ? "HIGH" : "NORMAL" } });
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const previous = await db.webhookInbox.findUnique({ where: { organisationId_provider_externalEventId: eventKey } });
      if (previous?.status === "SUCCEEDED") return new Response(null, { status: 204 });
    }
    throw error;
  }
  return new Response(null, { status: 204 });
}

import { NextRequest, NextResponse } from "next/server";
import { completeBlendSignEnvelope } from "@/lib/leasing-service";
import { validBlendSignWebhookSignature } from "@/lib/blendsign-webhook-security";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!validBlendSignWebhookSignature(body, request.headers.get("x-blendsign-signature"), process.env.BLENDSIGN_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const event = request.headers.get("x-blendsign-event");
  const externalEventId = typeof payload === "object" && payload !== null && "id" in payload && typeof payload.id === "string" ? payload.id : null;
  const payloadEvent = typeof payload === "object" && payload !== null && "event" in payload && typeof payload.event === "string" ? payload.event : null;
  const envelopeId = typeof payload === "object" && payload !== null && "data" in payload && typeof payload.data === "object" && payload.data !== null && "envelopeId" in payload.data && typeof payload.data.envelopeId === "string" ? payload.data.envelopeId : null;
  if (!event || event !== payloadEvent || !externalEventId || !envelopeId) return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  if (event !== "envelope.completed") return NextResponse.json({ received: true, ignored: true });

  const document = await db.document.findUnique({ where: { externalId: envelopeId }, include: { tenancy: { include: { facility: true } } } });
  if (!document) return NextResponse.json({ error: "Envelope is not linked to a Stor24 lease." }, { status: 404 });
  const existing = await db.webhookInbox.findUnique({ where: { organisationId_provider_externalEventId: { organisationId: document.tenancy.facility.organisationId, provider: "BLENDSIGN", externalEventId } } });
  if (existing?.status === "SUCCEEDED") return NextResponse.json({ received: true, idempotent: true });
  const inbox = existing
    ? await db.webhookInbox.update({ where: { id: existing.id }, data: { status: "PROCESSING", attempts: { increment: 1 }, failureCode: null, failureMessage: null } })
    : await db.webhookInbox.create({ data: { organisationId: document.tenancy.facility.organisationId, facilityId: document.tenancy.facilityId, provider: "BLENDSIGN", eventType: event, externalEventId, payload: JSON.parse(body), headers: { event }, status: "PROCESSING", attempts: 1 } });
  try {
    const result = await completeBlendSignEnvelope(envelopeId);
    await db.webhookInbox.update({ where: { id: inbox.id }, data: { status: "SUCCEEDED", processedAt: new Date(), failureCode: null, failureMessage: null } });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    await db.webhookInbox.update({ where: { id: inbox.id }, data: { status: "FAILED", failureCode: error instanceof Error ? error.message : "UNKNOWN", failureMessage: error instanceof Error ? error.message : "Webhook processing failed." } });
    throw error;
  }
}

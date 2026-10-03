import type { Prisma, PrismaClient } from "@/generated/prisma/client";
type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
/** Called only after a real booking cancellation/expiry, inside its existing transaction. */
export async function releaseLeadBookingStage(tx: Tx, input: { leadId: string | null; facilityId: string; organisationId: string; actorId?: string; reservationId: string }) {
  if (!input.leadId) return;
  await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${input.leadId} FOR UPDATE`;
  const lead = await tx.lead.findFirst({ where: { id: input.leadId, facilityId: input.facilityId, facility: { organisationId: input.organisationId } },
    include: { reservations: { select: { status: true } } } });
  if (!lead || !["RESERVED", "VIEWING_BOOKED"].includes(lead.stage) || lead.reservations.some(r => ["ACTIVE", "CONVERTED"].includes(r.status))) return;
  const stage = lead.stage === "RESERVED" ? "QUOTED" : "CONTACTED";
  await tx.lead.update({ where: { id: lead.id }, data: { stage } });
  await tx.auditEvent.create({ data: { organisationId: input.organisationId, facilityId: input.facilityId, actorId: input.actorId,
    action: "lead.stage_changed", entityType: "Lead", entityId: lead.id, before: { stage: lead.stage },
    after: { stage, reservationId: input.reservationId, reason: "BOOKING_HOLD_ENDED" } as Prisma.InputJsonValue } });
}

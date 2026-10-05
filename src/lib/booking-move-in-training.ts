import {publicCheckoutTotal} from "./public-initial-rent";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { trainingAccess, type TrainingSnapshot } from "@/lib/move-in-training";
import { advanceTraining, initialTrainingState, type TrainingAction, type TrainingState } from "@/lib/move-in-training-contract";

const eventAction = "training.booking_move_in";
type Stored = { generation: number; version: number; state: TrainingState; trainingOnly: true };

async function snapshot(tx: Prisma.TransactionClient, userId: string, reservationId: string) {
  const access = await trainingAccess(tx, userId);
  const reservation = await tx.reservation.findFirst({ where: {
    id: reservationId, facilityId: { in: access.facilities.map(f => f.id) },
    customer: { organisationId: access.organisationId }, journey: "RENTAL", status: "ACTIVE",
  }, include: { unit: { select: { number: true } }, publicLease: { select: { status: true, signedAt: true, signedPdfSha256: true } }, packageSelection: { select: { priceSnapshot: true } } } });
  if (!reservation) throw new Error("FORBIDDEN");
  const control = await tx.moveInTrainingControl.findUnique({ where: { organisationId: access.organisationId } });
  const generation = control?.generation ?? 0;
  // Version order is authoritative: transaction start timestamps can be out of order under lock contention.
  const saved = control?.enabled ? await tx.$queryRaw<{ after: Stored }[]>`
    SELECT "after" FROM "AuditEvent" WHERE "organisationId" = ${access.organisationId}
    AND "facilityId" = ${reservation.facilityId} AND "actorId" = ${userId}
    AND "entityType" = 'Reservation' AND "entityId" = ${reservationId} AND "action" = ${eventAction}
    AND ("after"->>'generation')::int = ${generation}
    ORDER BY ("after"->>'version')::int DESC LIMIT 1` : [];
  const stored = saved[0]?.after;
  const requiredAmount = publicCheckoutTotal(reservation);
  if (!Number.isFinite(requiredAmount) || requiredAmount <= 0) throw new Error("TRAINING_STEP_REQUIRED");
  const data: TrainingSnapshot = {
    enabled: control?.enabled ?? false, controlVersion: control?.version ?? 0,
    canToggle: access.owner && (!control || control.controllerUserId === userId),
    facilities: access.facilities, facilityId: reservation.facilityId,
    booking: { reservationId, generation, unitNumber: reservation.unit.number, requiredAmount },
    run: stored ? { version: stored.version, state: stored.state } : null,
  };
  return { access, reservation, generation, data };
}

export async function bookingMoveInTrainingSnapshot(userId: string, reservationId: string) {
  return db.$transaction(async tx => (await snapshot(tx, userId, reservationId)).data);
}

/** Only append training audits. Never call live payment, ID/photo approval, tenancy or access services. */
export async function bookingMoveInTrainingCommand(userId: string, input: TrainingAction, sampleValidated = false) {
  if (input.action === "toggle" || !input.reservationId) throw new Error("FORBIDDEN");
  const reservationId = input.reservationId;
  const access = await trainingAccess(db, userId);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${access.organisationId} FOR UPDATE`;
    const current = await snapshot(tx, userId, reservationId);
    if (current.access.organisationId !== access.organisationId || current.reservation.facilityId !== input.facilityId) throw new Error("FORBIDDEN");
    if (!current.data.enabled) throw new Error("TRAINING_DISABLED");
    if (input.generation !== current.generation) throw new Error("TRAINING_CHANGED");
    const run = current.data.run;
    if (input.action === "start" && run) return current.data;
    if (input.action !== "start" && (!run || run.version !== input.version)) throw new Error("TRAINING_CHANGED");
    if (run && run.state.bookingRequired !== current.data.booking!.requiredAmount && input.action !== "reset") throw new Error("TRAINING_CHANGED");
    if (input.action === "reset" && !current.access.owner) throw new Error("FORBIDDEN");
    if (input.action === "photo" && !sampleValidated) throw new Error("TRAINING_SAMPLE_REQUIRED");
    let state: TrainingState;
    if (input.action === "start" || input.action === "reset") {
      const receipt = await tx.auditEvent.findFirst({ where: {
        organisationId: access.organisationId, facilityId: input.facilityId, entityType: "Reservation", entityId: reservationId,
        action: "training.booking_payment_recorded", after: { path: ["generation"], equals: current.generation },
      }, orderBy: { occurredAt: "desc" } });
      const amount = (receipt?.after as { amount?: number } | undefined)?.amount ?? 0;
      state = { ...initialTrainingState(), unit: current.reservation.unitId, bookingRequired: current.data.booking!.requiredAmount,
        agreement: current.reservation.publicLease?.status === "SIGNED" && Boolean(current.reservation.publicLease.signedAt && current.reservation.publicLease.signedPdfSha256),
        paid: Number.isFinite(amount) && amount > 0 ? amount : 0 };
    } else {
      state = advanceTraining(run!.state, input.action, input.action === "photo" ? "validated-sample" : input.value);
    }
    const version = (run?.version ?? 0) + 1;
    await tx.auditEvent.create({ data: { organisationId: access.organisationId, facilityId: input.facilityId, actorId: userId,
      action: eventAction, entityType: "Reservation", entityId: reservationId,
      after: { generation: current.generation, version, state, trainingOnly: true, fundsReceived: false, transition: input.action },
    } });
    return { ...current.data, run: { version, state } };
  });
}

import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { currentRoleAccess } from "./current-role-access";
import { db } from "./db";
import { walkInPhotoToken, walkInTokenHash, walkInUsable } from "./walk-in-policy";

export const walkInPhotoReservation = {
  source: true, journey: true, status: true, customerId: true,
  customer: { select: { type: true, hikCentralFaceCapture: { select: { status: true, version: true, facilityId: true } } } },
  publicLease: { select: { status: true, signedAt: true } },
} satisfies Prisma.ReservationSelect;

export function usesWalkInPhoto(reservation: { source: string; journey: string; customer: { type: string } }) {
  return reservation.source === "PUBLIC_WALK_IN" && reservation.journey === "RENTAL" && reservation.customer.type === "INDIVIDUAL";
}

/** The consumed tablet handoff identifies exactly the version it captured. Clearing the tablet preserves that evidence. */
export async function walkInHandoverPhoto(
  database: Prisma.TransactionClient,
  organisationId: string,
  reservation: { id: string; customerId: string; facilityId: string },
) {
  const visit = await database.walkInVisit.findUnique({
    where: { reservationId: reservation.id },
    select: { customerTokenHash: true, organisationId: true, facilityId: true },
  });
  if (!visit?.customerTokenHash || visit.organisationId !== organisationId || visit.facilityId !== reservation.facilityId) return null;

  const tokenHash = createHash("sha256").update(walkInPhotoToken(visit.customerTokenHash)).digest("hex");
  const [handoff, photo] = await Promise.all([
    database.hikCentralFaceHandoff.findUnique({ where: { tokenHash },
      select: { customerId: true, organisationId: true, facilityId: true, usedAt: true, photoVersion: true },
    }),
    database.hikCentralFaceCapture.findUnique({ where: { customerId: reservation.customerId },
      select: { id: true, version: true, organisationId: true, facilityId: true, personId: true, status: true, consentAt: true, reviewedAt: true, providerAcceptedAt: true },
    }),
  ]);
  if (!handoff?.usedAt || !photo || handoff.customerId !== reservation.customerId ||
      handoff.organisationId !== organisationId || handoff.facilityId !== reservation.facilityId ||
      photo.organisationId !== organisationId || photo.facilityId !== reservation.facilityId ||
      photo.version !== handoff.photoVersion + 1 || photo.consentAt.getTime() !== handoff.usedAt.getTime()) return null;

  if (photo.status === "PROVIDER_ACCEPTED") {
    // Provider acceptance erases the local copy. The current active person link is the remaining access evidence.
    const link = await database.integrationIdentityLink.findUnique({ where: { customerId: reservation.customerId },
      select: { organisationId: true, status: true, hikCentralPersonId: true },
    });
    if (!photo.personId || !photo.reviewedAt || !photo.providerAcceptedAt || link?.organisationId !== organisationId ||
        link.status !== "ACTIVE" || link.hikCentralPersonId !== photo.personId) return { ...photo, status: "PROVIDER_UNCERTAIN" };
  }
  return photo;
}

export function eligibleWalkInReservation(reservation: Prisma.ReservationGetPayload<{ select: typeof walkInPhotoReservation }> | null) {
  return Boolean(reservation && usesWalkInPhoto(reservation) && ["ACTIVE", "CONVERTED"].includes(reservation.status));
}

type WalkInPhotoVisit = {
  id: string; customerTokenHash: string | null; facilityId: string;
  reservation: Prisma.ReservationGetPayload<{ select: typeof walkInPhotoReservation }> | null;
};

export async function walkInPhotoStatus(visit: WalkInPhotoVisit, database: Prisma.TransactionClient = db) {
  if (!eligibleWalkInReservation(visit.reservation) || !visit.customerTokenHash) return null;
  const token = walkInPhotoToken(visit.customerTokenHash);
  const handoff = await database.hikCentralFaceHandoff.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    select: { customerId: true, facilityId: true, usedAt: true, expiresAt: true },
  });
  if (!handoff || handoff.customerId !== visit.reservation?.customerId || handoff.facilityId !== visit.facilityId) return null;
  if (handoff.usedAt) return "saved";
  if (handoff.expiresAt <= new Date()) return null;
  const lease = visit.reservation?.publicLease;
  return lease?.status === "SIGNED" && lease.signedAt ? "ready" : "waiting-for-signature";
}

export type WalkInPhotoBinding = { session: string; expectedPhotoToken?: string };
export async function activeWalkInPhoto(database: Prisma.TransactionClient, binding: WalkInPhotoBinding, lock = false) {
  if (!/^[a-f0-9]{64}$/.test(binding.session)) throw Error("PHOTO_CHANGED");
  const hash = walkInTokenHash(binding.session);
  if (lock) await database.$queryRaw`SELECT "id" FROM "WalkInVisit" WHERE "customerTokenHash" = ${hash} FOR UPDATE`;
  const visit = await database.walkInVisit.findUnique({
    where: { customerTokenHash: hash },
    include: {
      facility: { select: { active: true, publicBookingEnabled: true } },
      createdBy: { select: { active: true, roleAssignments: { include: { role: true } } } },
      reservation: { select: walkInPhotoReservation },
    },
  });
  if (!visit || !walkInUsable(visit) ||
    !currentRoleAccess(visit.createdBy.roleAssignments, "reservations.manage", visit.facilityId).allowed ||
    await walkInPhotoStatus(visit, database) !== "ready") throw Error("PHOTO_CHANGED");
  const token = walkInPhotoToken(hash);
  if (binding.expectedPhotoToken && binding.expectedPhotoToken !== token) throw Error("PHOTO_CHANGED");
  return token;
}

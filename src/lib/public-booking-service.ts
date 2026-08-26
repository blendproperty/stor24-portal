import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  createPublicReference,
  reservationHoldHours,
  type PublicReservationInput,
} from "@/lib/public-booking-contract";
import { notifyReservationConfirmed } from "@/lib/notifications";

export class PublicBookingError extends Error {
  constructor(
    public readonly code: "FACILITY_NOT_FOUND" | "UNIT_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT",
    public readonly status: 404 | 409,
  ) {
    super(code);
  }
}

function reservationResult(reservation: {
  publicReference: string | null;
  status: string;
  holdExpiresAt: Date | null;
  quotedRate: { toString(): string };
  unit: { number: string; unitType: { name: string; areaSqMetres: { toString(): string } | null } };
  facility: { name: string; publicSlug: string | null };
}) {
  return {
    reference: reservation.publicReference,
    status: reservation.status,
    holdExpiresAt: reservation.holdExpiresAt?.toISOString() ?? null,
    quotedMonthlyRateZar: Number(reservation.quotedRate.toString()),
    facility: { name: reservation.facility.name, slug: reservation.facility.publicSlug },
    unit: {
      number: reservation.unit.number,
      type: reservation.unit.unitType.name,
      areaSqMetres: reservation.unit.unitType.areaSqMetres
        ? Number(reservation.unit.unitType.areaSqMetres.toString())
        : null,
    },
  };
}

const reservationInclude = {
  facility: { select: { name: true, publicSlug: true } },
  unit: { select: { number: true, unitType: { select: { name: true, areaSqMetres: true } } } },
} satisfies Prisma.ReservationInclude;

export async function createPublicReservation(input: PublicReservationInput, ipHash: string) {
  const existing = await db.reservation.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: reservationInclude,
  });
  if (existing) {
    if (existing.facility.publicSlug !== input.facilitySlug)
      throw new PublicBookingError("IDEMPOTENCY_CONFLICT", 409);
    return reservationResult(existing);
  }

  const facility = await db.facility.findFirst({
    where: { publicSlug: input.facilitySlug, publicBookingEnabled: true, active: true },
    select: { id: true, organisationId: true, name: true },
  });
  if (!facility) throw new PublicBookingError("FACILITY_NOT_FOUND", 404);

  try {
    const reservation = await db.$transaction(async (tx) => {
      const unit = await tx.unit.findFirst({
        where: { id: input.unitId, facilityId: facility.id },
        include: { unitType: true },
      });
      if (!unit || unit.status !== "AVAILABLE")
        throw new PublicBookingError("UNIT_UNAVAILABLE", 409);

      const claimed = await tx.unit.updateMany({
        where: { id: unit.id, facilityId: facility.id, status: "AVAILABLE" },
        data: { status: "RESERVED" },
      });
      if (claimed.count !== 1) throw new PublicBookingError("UNIT_UNAVAILABLE", 409);

      let customer = await tx.customer.findFirst({
        where: { organisationId: facility.organisationId, email: { equals: input.email, mode: "insensitive" } },
        orderBy: { updatedAt: "desc" },
      });
      const consent = {
        ...input.communicationConsent,
        recordedAt: new Date().toISOString(),
        source: "PUBLIC_WEBSITE",
      };
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            organisationId: facility.organisationId,
            type: "INDIVIDUAL",
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            communicationConsent: consent,
          },
        });
      } else {
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            firstName: customer.firstName || input.firstName,
            lastName: customer.lastName || input.lastName,
            phone: customer.phone || input.phone,
            communicationConsent: consent,
          },
        });
      }

      const lead = await tx.lead.create({
        data: {
          facilityId: facility.id,
          customerId: customer.id,
          desiredUnitTypeId: unit.unitTypeId,
          stage: "RESERVED",
          source: "PUBLIC_WEBSITE",
          expectedMoveIn: input.intendedMoveIn,
          notes: input.websitePath ? `Website path: ${input.websitePath}` : undefined,
        },
      });
      const holdExpiresAt = new Date(Date.now() + reservationHoldHours() * 60 * 60 * 1000);
      const created = await tx.reservation.create({
        data: {
          facilityId: facility.id,
          customerId: customer.id,
          leadId: lead.id,
          unitId: unit.id,
          quotedRate: unit.monthlyRate,
          holdExpiresAt,
          intendedMoveIn: input.intendedMoveIn,
          publicReference: createPublicReference(),
          idempotencyKey: input.idempotencyKey,
          source: "PUBLIC_WEBSITE",
        },
        include: reservationInclude,
      });
      await tx.auditEvent.create({
        data: {
          organisationId: facility.organisationId,
          facilityId: facility.id,
          action: "public_reservation.created",
          entityType: "Reservation",
          entityId: created.id,
          requestId: input.idempotencyKey,
          ipHash,
          after: {
            source: "PUBLIC_WEBSITE",
            unitId: unit.id,
            leadId: lead.id,
            holdExpiresAt: holdExpiresAt.toISOString(),
          },
        },
      });
      return { created, customerId: customer.id };
    });

    const { created, customerId } = reservation;

    // Notification is best-effort: it must never fail or roll back the
    // reservation that already succeeded above. notifyReservationConfirmed()
    // swallows its own errors and logs every attempt to CommunicationLog.
    try {
      await notifyReservationConfirmed({
        organisationId: facility.organisationId,
        facilityId: facility.id,
        customerId,
        idempotencyKey: input.idempotencyKey,
        consent: input.communicationConsent,
        to: { email: input.email, phone: input.phone },
        variables: {
          firstName: input.firstName,
          facilityName: created.facility.name,
          unitNumber: created.unit.number,
          monthlyRateZar: created.quotedRate.toString(),
          holdExpiresAt: created.holdExpiresAt?.toISOString() ?? "",
          intendedMoveIn: created.intendedMoveIn
            ? created.intendedMoveIn.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" })
            : "To be confirmed",
          reference: created.publicReference ?? "",
        },
      });
    } catch {
      // Already logged per-channel inside notifyReservationConfirmed; a
      // notification failure must never surface as a booking failure.
    }

    return reservationResult(created);
  } catch (error) {
    if (error instanceof PublicBookingError) throw error;
    if ((error as { code?: string }).code === "P2002") {
      const duplicate = await db.reservation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: reservationInclude,
      });
      if (duplicate && duplicate.facility.publicSlug === input.facilitySlug)
        return reservationResult(duplicate);
      throw new PublicBookingError("IDEMPOTENCY_CONFLICT", 409);
    }
    throw error;
  }
}

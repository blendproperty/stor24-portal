import { bookingPreferenceRecord } from "@/lib/privacy-preferences";
import { db } from "@/lib/db";
import type { PublicLeadInput } from "@/lib/public-lead-contract";

export class PublicLeadError extends Error {
  constructor(
    public readonly code: "FACILITY_NOT_FOUND",
    public readonly status: 404,
  ) {
    super(code);
  }
}

/**
 * Creates (or updates) a Customer and a NEW-stage Lead from a public quote
 * form submission. No unit is claimed and no Reservation is created — that
 * only happens once a customer picks a specific unit through the booking
 * flow (see public-booking-service.ts).
 *
 * The quote form only asks for a general area, not a specific facility, so
 * this attaches to the facility matching `facilitySlug` if given, otherwise
 * the first facility with public booking enabled (currently just Midpoint —
 * see stor24-portal/PROJECT_CONTEXT.md "Pilot facility and first-release
 * scope"). Revisit this fallback once more than one facility is public.
 */
export async function createPublicLead(input: PublicLeadInput, ipHash: string) {
  const facility = input.facilitySlug
    ? await db.facility.findFirst({
        where: { publicSlug: input.facilitySlug, publicBookingEnabled: true, active: true },
        select: { id: true, organisationId: true, name: true, publicSlug: true },
      })
    : await db.facility.findFirst({
        where: { publicBookingEnabled: true, active: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, organisationId: true, name: true, publicSlug: true },
      });
  if (!facility) throw new PublicLeadError("FACILITY_NOT_FOUND", 404);

  const notes = [
    input.area ? `Area requested: ${input.area}` : null,
    input.storageType ? `Storage type: ${input.storageType}` : null,
    input.items ? `Items: ${input.items}` : null,
    input.unitSizeEstimate ? `Estimated size: ${input.unitSizeEstimate}` : null,
    input.duration ? `Duration: ${input.duration}` : null,
    input.collectionPreference ? `Collection/transport: ${input.collectionPreference}` : null,
    input.contactMethod ? `Preferred contact: ${input.contactMethod}` : null,
    input.websitePath ? `Website path: ${input.websitePath}` : null,
  ].filter(Boolean).join("\n");

  const preferenceEvidence = { ...bookingPreferenceRecord({}, input.privacyNoticeVersion, "PUBLIC_QUOTE_FORM"), purpose: "RESPOND_TO_ENQUIRY", preferredContact: input.contactMethod ?? null };
  return db.$transaction(async (tx) => {
    let customer = await tx.customer.findFirst({
      where: { organisationId: facility.organisationId, email: { equals: input.email, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
    });
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          organisationId: facility.organisationId,
          type: "INDIVIDUAL",
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          communicationConsent: preferenceEvidence,
        },
      });
    } else {
      customer = await tx.customer.update({
        where: { id: customer.id },
        data: {
          firstName: customer.firstName || input.firstName,
          lastName: customer.lastName || input.lastName,
          phone: customer.phone || input.phone,
        },
      });
    }

    const lead = await tx.lead.create({
      data: {
        facilityId: facility.id,
        customerId: customer.id,
        stage: "NEW",
        source: "PUBLIC_QUOTE_FORM",
        expectedMoveIn: input.intendedMoveIn,
        notes: notes || undefined,
      },
    });

    await tx.auditEvent.create({
      data: {
        organisationId: facility.organisationId,
        facilityId: facility.id,
        action: "public_lead.created",
        entityType: "Lead",
        entityId: lead.id,
        ipHash,
        after: { source: "PUBLIC_QUOTE_FORM", customerId: customer.id, communicationPreferences: preferenceEvidence },
      },
    });

    return { id: lead.id, facility: { name: facility.name, slug: facility.publicSlug } };
  });
}

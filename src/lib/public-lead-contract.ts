import { leadAttributionSchema } from "@/lib/lead-attribution";
import { z } from "zod";

/**
 * Contract for the public "quote form" lead — distinct from
 * publicReservationSchema (public-booking-contract.ts), which requires a
 * specific unitId. The quote form on the marketing site collects a general
 * enquiry (area, rough storage type/size, no unit chosen yet), so this
 * creates a Customer + Lead only, not a Reservation.
 */
export const publicLeadSchema = z.object({
  productLine: z.enum(["STORAGE", "MICRO_WAREHOUSE"]).default("STORAGE"),
  businessDetails: z.object({ companyName: z.string().trim().max(150), registrationNumber: z.string().trim().max(80).optional(), taxNumber: z.string().trim().max(80).optional(), intendedUse: z.string().trim().max(500).optional() }).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  phone: z.string().trim().min(7).max(30),
  facilitySlug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  area: z.string().trim().max(80).optional(),
  storageType: z.string().trim().max(40).optional(),
  items: z.string().trim().max(500).optional(),
  unitSizeEstimate: z.string().trim().max(40).optional(),
  intendedMoveIn: z.coerce.date().optional(),
  duration: z.string().trim().max(80).optional(),
  collectionPreference: z.string().trim().max(80).optional(),
  privacyNoticeVersion: z.string().trim().max(80).optional(),
  contactMethod: z.string().trim().max(40).optional(),
  attribution: leadAttributionSchema.optional().catch(undefined),
  websitePath: z.string().trim().max(300).optional(),
  honeypot: z.string().max(0).optional(),
});

export type PublicLeadInput = Omit<z.infer<typeof publicLeadSchema>, "productLine"> & { productLine?: "STORAGE" | "MICRO_WAREHOUSE" };

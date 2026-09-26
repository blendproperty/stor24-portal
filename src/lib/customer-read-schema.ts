import { z } from "zod";
const text = z.string().nullable();
const contact = z.record(z.string(), z.string()).nullable();
const facility = z.object({ name: z.string() });
const lease = z.object({ id: z.string(), status: z.string(), version: z.string(), paymentMethod: z.string(), signedAt: text, signedPdfSha256: text, mandate: z.object({ status: z.string(), reference: z.string(), signedPdfSha256: text }).nullable().optional() });
export const customerReadSchema = z.object({ data: z.array(z.object({
  id: z.string().min(1), type: z.string(), firstName: text, lastName: text, companyName: text, email: text, phone: text, identityRef: text, taxNumber: text, dateOfBirth: text, notes: text,
  billingAddress: contact, alternateContact: contact, workContact: contact, emergencyContact: contact,
  communicationConsent: z.object({ email: z.boolean().optional(), sms: z.boolean().optional(), phone: z.boolean().optional(), whatsapp: z.boolean().optional() }).nullable(),
  tenancies: z.array(z.object({ id: z.string(), status: z.string(), startDate: z.string(), endDate: text, facility, account: z.object({ accountNumber: z.string(), balance: z.string().refine(v => v.trim() !== "" && Number.isFinite(Number(v))) }), occupancies: z.array(z.object({ status: z.string(), unit: z.object({ number: z.string(), unitType: z.object({ name: z.string() }) }) })) })),
  leads: z.array(z.object({ id: z.string(), stage: z.string(), source: z.string(), updatedAt: z.string() })),
  reservations: z.array(z.object({ id: z.string(), status: z.string(), facility, unit: z.object({ number: z.string() }), publicLease: lease.nullable() })),
})) });
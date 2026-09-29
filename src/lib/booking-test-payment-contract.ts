import { z } from "zod";

export const bookingTestPaymentSchema = z.object({
  reservationId: z.string().min(1).max(100),
  generation: z.number().int().nonnegative(),
  amount: z.number().positive().max(10_000_000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001),
  testConfirmed: z.literal(true),
});
export const bookingTestPaymentSnapshotSchema = z.object({
  reservationId: z.string(), enabled: z.boolean(), generation: z.number().int(),
  receipt: z.object({ id: z.string(), amount: z.number().positive(), recordedAt: z.string().datetime(), testOnly: z.literal(true) }).nullable(),
});
export type BookingTestPaymentSnapshot = z.infer<typeof bookingTestPaymentSnapshotSchema>;

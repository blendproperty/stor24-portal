import { z } from "zod";

export const trainingDebtorRecord = z.object({
  version: z.literal(1), trainingOnly: z.literal(true),
  customerId: z.string().min(1), facilityId: z.string().min(1),
  reference: z.literal("TRAINING-DEBTOR-001"),
  chargedCents: z.literal(100000), illustrativePaidCents: z.literal(40000),
}).strict();
export const trainingDebtorCreate = z.object({ facilityId: z.string().min(1).max(100) }).strict();
export type TrainingDebtorRecord = z.infer<typeof trainingDebtorRecord>;
export type TrainingDebtorRow = TrainingDebtorRecord & { name: string; facility: string; createdAt: string; outstandingCents: number };
export type TrainingDebtorSnapshot = { canCreate: boolean; facilities: { id: string; name: string }[]; rows: TrainingDebtorRow[] };
export const trainingDebtorRead = z.object({ data: z.object({
  canCreate: z.boolean(), facilities: z.array(z.object({ id: z.string(), name: z.string() })),
  rows: z.array(trainingDebtorRecord.extend({ name: z.string(), facility: z.string(), createdAt: z.iso.datetime(), outstandingCents: z.literal(60000) })),
}) });
export const trainingMoney = (cents: number) => `R ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

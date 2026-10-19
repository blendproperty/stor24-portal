import { z } from "zod";
import { southAfricaDateKey } from "./south-africa-time";

/** Adapter contract, not a public command. Only a qualified authenticated provider
 * adapter may supply these records. Parsing a record does not authenticate it.
 * This reducer is deliberately not connected to the live arrears eligibility path. */
const id = z.string().trim().min(1).max(200);
// Keep four-digit calendar arithmetic inside its representable range after +7.
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "9998-12-31");
const instant = z.iso.datetime({ offset: true }).refine(value => {
  const year = new Date(value).getUTCFullYear();
  return year >= 1900 && year <= 9998;
});
const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const binding = {
  organisationId: id, facilityId: id, merchantId: id, connectionId: id,
  accountId: id, originalChargeId: id, invoiceId: id, mandateId: id,
  batchId: id, instructionId: id, customerReference: id,
  actionDate: date, amountCents: cents, currency: z.literal("ZAR"),
};
export const debitInstructionEvidenceSchema = z.object(binding).strict();
const failureDate = z.discriminatedUnion("precision", [
  z.object({ precision: z.literal("DAY"), value: date }).strict(),
  z.object({ precision: z.literal("INSTANT"), value: instant }).strict(),
]);
export const debitResultEvidenceSchema = z.object({
  ...binding, eventId: id, rawEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: instant, sourceAt: instant,
  outcome: z.enum(["FINAL_UNPAID", "PENDING", "TRACKING", "TECHNICAL_REJECTION", "SETTLED", "DISPUTED", "CORRECTION"]),
  failure: failureDate.nullable(), reason: z.string().trim().min(1).max(500),
}).strict().superRefine((event, ctx) => {
  if ((event.outcome === "FINAL_UNPAID") !== (event.failure !== null)) {
    ctx.addIssue({ code: "custom", message: "Only final unpaid results must contain the provider-confirmed failure date." });
  }
  if (Date.parse(event.sourceAt) > Date.parse(event.observedAt)) {
    ctx.addIssue({ code: "custom", message: "Provider evidence cannot be observed before its source time." });
  }
  if (event.failure) {
    const day = event.failure.precision === "DAY" ? event.failure.value : southAfricaDateKey(event.failure.value);
    if (day < event.actionDate || day > southAfricaDateKey(event.sourceAt) ||
        event.failure.precision === "INSTANT" && Date.parse(event.failure.value) > Date.parse(event.sourceAt)) {
      ctx.addIssue({ code: "custom", message: "Confirmed failure must fall between the original action date and source time." });
    }
  }
});
export type DebitInstructionEvidence = z.infer<typeof debitInstructionEvidenceSchema>;
export type DebitResultEvidence = z.infer<typeof debitResultEvidenceSchema>;

const keys = Object.keys(binding) as (keyof DebitInstructionEvidence)[];
const dayAfterSeven = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);

/** Deterministic reconciliation of a COMPLETE retained evidence set for one debt.
 * Caller must bound/query the original debt before invocation, retain raw records,
 * and independently establish current ledger, payment, dispute and arrangement holds.
 * Never use this output as authority for a fee, notice or physical access command. */
export function reconcileDebitFailure(input: {
  asOf: string;
  debt: { organisationId: string; facilityId: string; merchantId: string; connectionId: string; accountId: string; originalChargeId: string; invoiceId: string; amountCents: number };
  instructions: unknown[];
  results: unknown[];
}) {
  date.parse(input.asOf);
  const debt = z.object({ organisationId: id, facilityId: id, merchantId: id, connectionId: id, accountId: id, originalChargeId: id, invoiceId: id, amountCents: cents }).strict().parse(input.debt);
  const blockers = new Set<string>();
  const instructions = new Map<string, DebitInstructionEvidence>();
  const conflictingInstructions = new Set<string>();
  if (input.instructions.length > 1000 || input.results.length > 10000) throw Error("DEBIT_EVIDENCE_LIMIT");
  for (const raw of input.instructions) {
    const parsed = debitInstructionEvidenceSchema.safeParse(raw);
    if (!parsed.success) { blockers.add("INVALID_INSTRUCTION"); continue; }
    const instruction = parsed.data;
    if (Object.keys(debt).some(key => instruction[key as keyof typeof debt] !== debt[key as keyof typeof debt])) {
      blockers.add("ORIGINAL_DEBT_MISMATCH"); continue;
    }
    const prior = instructions.get(instruction.instructionId);
    if (prior && keys.some(key => prior[key] !== instruction[key])) {
      blockers.add("CONFLICTING_INSTRUCTION"); conflictingInstructions.add(instruction.instructionId); instructions.delete(instruction.instructionId);
    } else if (!conflictingInstructions.has(instruction.instructionId)) instructions.set(instruction.instructionId, instruction);
  }
  if (!instructions.size) blockers.add("NO_ORIGINAL_INSTRUCTION");
  // Identical re-deliveries are harmless. Conflicting reuse of an event identity
  // is retained as a hold, never last-write-wins. Retrieval time may differ.
  const events = new Map<string, DebitResultEvidence>();
  const conflictingEvents = new Set<string>();
  for (const raw of input.results) {
    const parsed = debitResultEvidenceSchema.safeParse(raw);
    if (!parsed.success) { blockers.add("INVALID_PROVIDER_RESULT"); continue; }
    const event = parsed.data, instruction = instructions.get(event.instructionId);
    if (!instruction || keys.some(key => instruction[key] !== event[key])) {
      blockers.add("UNMATCHED_PROVIDER_RESULT"); continue;
    }
    const identity = JSON.stringify([event.merchantId, event.connectionId, event.eventId]);
    const previous = events.get(identity);
    const canonical = (value: DebitResultEvidence) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "observedAt"));
    if (previous && JSON.stringify(canonical(previous)) !== JSON.stringify(canonical(event))) {
      blockers.add("CONFLICTING_PROVIDER_EVENT"); conflictingEvents.add(identity); events.delete(identity);
    } else if (!conflictingEvents.has(identity)) events.set(identity, event);
    if (southAfricaDateKey(event.sourceAt) > input.asOf) blockers.add("EVIDENCE_AFTER_AS_OF");
  }
  const failures: { day: string; eventId: string; precision: "DAY" | "INSTANT"; value: string }[] = [];
  for (const instruction of instructions.values()) {
    const results = [...events.values()].filter(event => event.instructionId === instruction.instructionId);
    if (!results.length) blockers.add("MISSING_INSTRUCTION_OUTCOME");
    // Any correction/dispute/settlement needs authoritative reconciliation. No
    // subsequent unpaid result may silently clear it or start a replacement clock.
    if (results.some(event => ["CORRECTION", "DISPUTED", "SETTLED"].includes(event.outcome))) blockers.add("RECONCILIATION_REQUIRED");
    const latestTime = results.reduce((n, event) => Math.max(n, Date.parse(event.sourceAt)), 0);
    if (results.some(event => Date.parse(event.sourceAt) === latestTime && event.outcome !== "FINAL_UNPAID")) blockers.add("OUTCOME_REVIEW_REQUIRED");
    if (new Set(results.filter(event => event.failure).map(event => JSON.stringify(event.failure))).size > 1) blockers.add("CONFLICTING_FAILURE_DATE");
    for (const event of results) {
      if (event.outcome !== "FINAL_UNPAID" || !event.failure) continue;
      const day = event.failure.precision === "DAY" ? event.failure.value : southAfricaDateKey(event.failure.value);
      failures.push({ day, eventId: event.eventId, precision: event.failure.precision, value: event.failure.value });
    }
  }
  failures.sort((a, b) => a.day.localeCompare(b.day) ||
    (a.precision === "INSTANT" && b.precision === "INSTANT" ? Date.parse(a.value) - Date.parse(b.value) : a.precision.localeCompare(b.precision)) ||
    a.eventId.localeCompare(b.eventId));
  const integrityHeld = [...blockers].some(blocker => /^(INVALID_|CONFLICTING_|UNMATCHED_|ORIGINAL_DEBT_|NO_ORIGINAL_)/.test(blocker));
  // Do not expose a plausible date chosen from contradictory/invalid evidence.
  const first = integrityHeld ? null : failures[0] ?? null;
  if (!first) blockers.add("NO_CONFIRMED_FAILURE");
  if (first && first.day > input.asOf) blockers.add("FAILURE_AFTER_AS_OF");
  const reviewOn = first ? dayAfterSeven(first.day) : null;
  return {
    originalChargeId: debt.originalChargeId, firstFailure: first, reviewOn,
    blockers: [...blockers].sort(), reconciled: blockers.size === 0,
    reviewDateReached: blockers.size === 0 && reviewOn !== null && input.asOf >= reviewOn,
    // Explicitly narrower than access-review eligibility: caller still needs
    // current unpaid ledger, live authority and all other operational holds.
    financialApproval: false as const, accessApproval: false as const,
  };
}

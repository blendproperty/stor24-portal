import { z } from "zod";

export const MRI_MOVEMENTS = ["CHARGE", "PAYMENT", "CREDIT", "REFUND", "REVERSAL", "WRITE_OFF"] as const;
const text = z.string().trim().max(120).refine(v => !/[\x00-\x1f\x7f]/.test(v), "Use plain text without control characters.");
const note = z.string().trim().max(2000);
export const mriMappingSchema = z.object({
  entityCode: text, propertyCode: text,
  basis: z.enum(["UNDECIDED", "ACCRUAL", "CASH"]),
  scopeNotes: note,
  rules: z.array(z.object({
    category: text.min(1), movement: z.enum(MRI_MOVEMENTS),
    debitAccount: text, creditAccount: text, taxAccount: text, taxCode: text,
    taxTreatment: z.enum(["UNDECIDED", "NO_TAX", "INCLUDED", "EXCLUSIVE"]),
    taxSide: z.enum(["UNDECIDED", "DEBIT", "CREDIT"]).default("UNDECIDED"),
    rationale: note,
  }).strict()).max(60),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.rules.forEach((r, i) => {
    const key = `${r.movement}:${r.category.toLowerCase()}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["rules", i, "category"], message: "Duplicate category for this movement." });
    seen.add(key);
  });
});
export type MriMapping = z.infer<typeof mriMappingSchema>;
export function emptyMriMapping(): MriMapping {
  return { entityCode: "", propertyCode: "", basis: "UNDECIDED", scopeNotes: "", rules: MRI_MOVEMENTS.map(movement => ({ movement, category: movement.toLowerCase().replace("_", " "), debitAccount: "", creditAccount: "", taxAccount: "", taxCode: "", taxTreatment: "UNDECIDED", taxSide: "UNDECIDED", rationale: "" })) };
}
export function mappingBlockers(mapping: MriMapping): string[] {
  const result: string[] = [];
  if (!mapping.entityCode) result.push("Confirm the MRI entity code.");
  if (!mapping.propertyCode) result.push("Confirm the MRI property code.");
  if (mapping.basis === "UNDECIDED") result.push("Choose the finance-approved accounting basis.");
  if (!mapping.scopeNotes) result.push("Document source coverage, exclusions and how source movements will be classified.");
  for (const movement of MRI_MOVEMENTS) if (!mapping.rules.some(r => r.movement === movement)) result.push(`Define the ${movement.toLowerCase().replace("_", " ")} mapping.`);
  for (const r of mapping.rules) {
    const label = `${r.movement} / ${r.category}`;
    if (!r.debitAccount || !r.creditAccount) result.push(`${label}: supply debit and credit GL accounts.`);
    else if (r.debitAccount.toLowerCase() === r.creditAccount.toLowerCase()) result.push(`${label}: debit and credit accounts must differ.`);
    if (r.taxTreatment === "UNDECIDED") result.push(`${label}: confirm tax treatment.`);
    if (["INCLUDED", "EXCLUSIVE"].includes(r.taxTreatment) && !r.taxAccount) result.push(`${label}: supply the tax GL account.`);
    if (["INCLUDED", "EXCLUSIVE"].includes(r.taxTreatment) && !r.taxCode) result.push(`${label}: confirm the MRI tax code.`);
    if (["INCLUDED", "EXCLUSIVE"].includes(r.taxTreatment) && r.taxSide === "UNDECIDED") result.push(`${label}: choose the tax journal side.`);
    if (r.taxTreatment === "NO_TAX" && r.taxAccount) result.push(`${label}: remove the tax GL account or choose a taxable treatment.`);
    if (!r.rationale) result.push(`${label}: document classification, signs, tax allocation and reversal handling where applicable.`);
  }
  return result;
}

/** Finance mapping review only, not a journal or provider import format. */
export function mappingReviewCsv(review: { mapping: MriMapping; status: string; revision: string | null; approvedAt: string | null; approvalReference: string | null }) {
  const cell = (value: string | null) => {
    const text = value ?? "";
    const safe = /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = [["Document", "Mapping finance review only - NOT an MRI journal import"], ["Status", review.status], ["Revision", review.revision], ["Entity", review.mapping.entityCode], ["Property", review.mapping.propertyCode], ["Basis", review.mapping.basis], ["Scope", review.mapping.scopeNotes], ["Approved at", review.approvedAt], ["Approval reference", review.approvalReference], [],
    ["Movement", "Category", "Debit GL", "Credit GL", "Tax GL", "Tax code", "Tax treatment", "Tax side", "Rationale"],
    ...review.mapping.rules.map(r => [r.movement, r.category, r.debitAccount, r.creditAccount, r.taxAccount, r.taxCode, r.taxTreatment, r.taxSide, r.rationale])];
  return "\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

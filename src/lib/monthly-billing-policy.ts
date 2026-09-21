import { z } from "zod";
import { southAfricaDateKey } from "./south-africa-time";

export const billingPeriodSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const money = z.number().finite().min(0).max(10000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use cents only");
export const billingPlanSchema = z.object({
  firstPeriod: billingPeriodSchema,
  proration: z.enum(["ACTUAL_DAYS", "FULL_MONTH"]),
  taxPercent: z.number().finite().min(0).max(100),
  rentTaxable: z.boolean(),
  insuranceEnabled: z.boolean(),
  insuranceTaxable: z.boolean(),
  charges: z.array(z.object({ code: z.string().min(1).max(40), name: z.string().min(1).max(120), amount: money, taxable: z.boolean() }).strict()).max(30),
  discount: z.object({ name: z.string().min(1).max(120), type: z.enum(["FIXED", "PERCENTAGE"]), value: money, startsPeriod: billingPeriodSchema, endsPeriod: billingPeriodSchema }).strict().nullable(),
  approvalReference: z.string().trim().min(5).max(250),
}).strict().superRefine((plan, ctx) => {
  if (new Set(plan.charges.map(c => c.code)).size !== plan.charges.length) ctx.addIssue({ code: "custom", message: "Duplicate charges" });
  if (plan.discount && (plan.discount.startsPeriod > plan.discount.endsPeriod || (plan.discount.type === "PERCENTAGE" && plan.discount.value > 100))) ctx.addIssue({ code: "custom", message: "Invalid discount" });
});
export type BillingPlan = z.infer<typeof billingPlanSchema>;
export type BillingLine = { key: string; description: string; amount: number; taxAmount: number; type: "CHARGE" | "CREDIT" };
export type BillingOccupancy = { id: string; number: string; monthlyRate: number; startDate: Date; endDate: Date | null };
export type BillingInsurance = { status: string; monthlyPremium: number | null; effectiveFrom: Date | null; endedAt: Date | null };
export function currentBillingPeriod(now = new Date()) { return southAfricaDateKey(now).slice(0, 7); }
export function periodDates(period: string) {
  billingPeriodSchema.parse(period);
  const [year, month] = period.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(days).padStart(2, "0")}`, days, effectiveAt: new Date(`${period}-01T00:00:00+02:00`) };
}
// End dates are exclusive, matching an occupancy's transfer/move-out boundary.
function coveredDays(start: Date, end: Date | null, period: string) {
  const month = periodDates(period);
  const from = southAfricaDateKey(start);
  const until = end ? southAfricaDateKey(end) : "9999-12-31";
  return Array.from({ length: month.days }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`).filter(day => day >= from && day < until);
}
export function calculateMonthlyBill(period: string, plan: BillingPlan, occupancies: BillingOccupancy[], insurance: BillingInsurance | null) {
  billingPlanSchema.parse(plan);
  const month = periodDates(period);
  if (period < plan.firstPeriod) throw new Error("BILLING_BEFORE_APPROVED_START");
  const lines: BillingLine[] = [];
  const occupiedDays = new Set<string>();
  function add(key: string, description: string, cents: number, taxable: boolean, type: "CHARGE" | "CREDIT" = "CHARGE") {
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > 1000000000) throw new Error("BILLING_AMOUNT_INVALID");
    const tax = taxable ? Math.round(cents * plan.taxPercent / (100 + plan.taxPercent)) : 0;
    lines.push({ key, description, amount: cents / 100, taxAmount: tax / 100, type });
  }
  for (const occupancy of occupancies) {
    const days = coveredDays(occupancy.startDate, occupancy.endDate, period);
    if (!days.length) continue;
    if (days.some(day => occupiedDays.has(day))) throw new Error("BILLING_OVERLAPPING_OCCUPANCIES");
    days.forEach(day => occupiedDays.add(day));
    const cents = Math.round(occupancy.monthlyRate * 100);
    add(`rent:${occupancy.id}`, `Rent — unit ${occupancy.number}, ${period}${plan.proration === "ACTUAL_DAYS" ? ` (${days.length}/${month.days} days)` : ""}`, plan.proration === "ACTUAL_DAYS" ? Math.round(cents * days.length / month.days) : cents, plan.rentTaxable);
  }
  if (!occupiedDays.size) throw new Error("BILLING_NO_OCCUPANCY_IN_PERIOD");
  if (plan.proration === "FULL_MONTH" && lines.length > 1) throw new Error("BILLING_TRANSFER_REQUIRES_REVIEW");
  const rent = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
  const discount = plan.discount;
  if (discount && period >= discount.startsPeriod && period <= discount.endsPeriod) {
    const cents = discount.type === "PERCENTAGE" ? Math.round(rent * discount.value / 100) : Math.round(discount.value * 100);
    if (cents > rent) throw new Error("BILLING_DISCOUNT_EXCEEDS_RENT");
    add("discount", discount.name, cents, plan.rentTaxable, "CREDIT");
  }
  for (const charge of plan.charges) add(`fee:${charge.code}`, charge.name, Math.round(charge.amount * 100), charge.taxable);
  if (plan.insuranceEnabled) {
    if (!insurance || !["ACTIVE", "ENDED"].includes(insurance.status) || insurance.monthlyPremium === null || !insurance.effectiveFrom) throw new Error("BILLING_INSURANCE_REQUIRES_REVIEW");
    const days = coveredDays(insurance.effectiveFrom, insurance.endedAt, period).filter(day => occupiedDays.has(day));
    if (days.length) add("insurance", `Insurance premium — ${period}`, plan.proration === "ACTUAL_DAYS" ? Math.round(insurance.monthlyPremium * 100 * days.length / month.days) : Math.round(insurance.monthlyPremium * 100), plan.insuranceTaxable);
  }
  const totalCents = lines.reduce((sum, line) => sum + (line.type === "CREDIT" ? -1 : 1) * Math.round(line.amount * 100), 0);
  return { period, lines, total: totalCents / 100, taxTotal: lines.reduce((sum, line) => sum + (line.type === "CREDIT" ? -1 : 1) * Math.round(line.taxAmount * 100), 0) / 100 };
}

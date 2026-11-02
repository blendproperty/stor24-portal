import source from "../../docs/legal/2026-11-02/confirmed-word-terms.json";
import { STORAGE_TERMS as octoberTerms, STORAGE_TERMS_INTRODUCTION as octoberIntroduction } from "./storage-terms-2026-10-20";
import { buildLeaseClauses, type LeaseClauseContext } from "./lease-agreement-content";
import { southAfricaDateKey } from "./south-africa-time";

export const STORAGE_TERMS_VERSION = "storage-terms-2026-11-02-customer";
export const STORAGE_TERMS_STATUS = "Customer terms and conditions";
export const STORAGE_TERMS_SOURCE = { filename: source.sourceFilename, sha256: source.sourceSha256 };
export const STORAGE_TERMS_INTRODUCTION = [
  "Read these terms with your personalised booking schedule, which identifies the customer, facility, unit, start date, payment method and agreed charges. We, Us and Our mean STOR24; You and Your mean the named customer or its authorised representative.",
  octoberIntroduction[1],
  "This edition applies when incorporated into your agreement. Existing accepted agreements retain their accepted edition. No security deposit is required under this edition. Mandatory consumer rights remain unaffected.",
];

// Keep the source intact; apply the owner's customer-only and no-deposit directions here.
export const STORAGE_TERMS = [
  { title: "Important risk notices", body: source.sections[1].body.replace("proposed exceptions", "exceptions").replace("The deposit, cancellation", "The cancellation"), refundRelevant: false },
  ...source.sections.filter(section => /^\d+ /.test(section.title)).map(section => {
    const number = Number(section.title.split(" ")[0]);
    let body = section.body;
    if (number === 10) body = "No security deposit is required for bookings made under this edition. Your booking schedule shows the initial rent, any optional goods and the total payable before acceptance.";
    if (number === 11) body = body.replace("periods, amounts, deposit and", "periods, amounts and").replace("the deposit or advance-payment requirements", "the advance-payment requirements");
    if (number === 20) body = body.replace("Initial rent and deposit must", "Initial rent must");
    return { title: section.title.replace(/^(\d+) /, "$1. "), body, refundRelevant: [1, 5, 10, 22].includes(number) };
  }),
  ...octoberTerms.filter(section => /^(15|16|2[1-8])\./.test(section.title)).map(section => ({
    title: `Website and goods terms — ${section.title.replace(/^\d+\. /, "")}`,
    body: section.body.replace("treatment of the deposit and ", ""),
    refundRelevant: /refund|cancellation|merchandise|interruption|fulfilment/i.test(section.title),
  })),
];

export function storageTermsText() {
  return ["FULL STORAGE TERMS AND CONDITIONS", `Terms version: ${STORAGE_TERMS_VERSION}`, ...STORAGE_TERMS_INTRODUCTION, "",
    ...STORAGE_TERMS.flatMap(section => [section.title, section.body, ""])].join("\n");
}

export function buildReviewLeaseClauses(ctx: LeaseClauseContext) {
  const references = { premises_and_use: [7], term_and_rent: [11, 10], access_and_security: [3, 4], insurance_and_liability: [6, 8], prohibited_items: [2], default_and_termination: [1, 12, 22], data_and_privacy: [17, 18, 21, 22], payment_authority: [20] };
  return buildLeaseClauses(ctx).map(clause => ({ ...clause, body:
    (clause.key === "term_and_rent" ? `Storage starts on ${southAfricaDateKey(ctx.startDate)}. Monthly rent: R ${ctx.monthlyRate.toFixed(2)} including applicable VAT. ` : "") +
    references[clause.key].map(number => STORAGE_TERMS[number].body).join("\n\n") }));
}

export function renderReviewLeaseDocument(ctx: LeaseClauseContext) {
  const rent = ctx.initialRent ?? { lines: [{ period: "Initial month", amount: ctx.monthlyRate }], total: ctx.monthlyRate };
  const goods = ctx.storagePackage?.priceZar ?? 0;
  return ["STOR24 STORAGE AGREEMENT", `Version: ${STORAGE_TERMS_VERSION}`, "", "YOUR BOOKING SCHEDULE",
    STORAGE_TERMS_INTRODUCTION[1], `Customer: ${ctx.customerName}`, `Facility: ${ctx.facilityName}`,
    `Unit: ${ctx.unitNumber}${ctx.unitTypeName ? ` (${ctx.unitTypeName})` : ""}`, `Start date: ${southAfricaDateKey(ctx.startDate)}`,
    `Monthly rent: R ${ctx.monthlyRate.toFixed(2)} including applicable VAT`, `Payment method: ${ctx.paymentMethod.replaceAll("_", " ")}`,
    ...rent.lines.map(line => `Initial rent — ${line.period}: R ${line.amount.toFixed(2)}`),
    "Security deposit: not required", ctx.storagePackage ? `Optional goods: ${ctx.storagePackage.name} — R ${goods.toFixed(2)} once-off. ${ctx.storagePackage.contents}` : "Optional goods: none",
    `Initial total: R ${(rent.total + goods).toFixed(2)}`, "", "YOUR SUMMARY ACKNOWLEDGEMENTS",
    ...buildReviewLeaseClauses(ctx).flatMap(clause => [clause.title, clause.body, ""]), storageTermsText()].join("\n");
}

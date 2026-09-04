/**
 * Renders a customer-facing invoice as branded, self-contained HTML.
 *
 * Deliberately HTML, not a binary PDF. PROJECT_CONTEXT.md's dependency
 * policy is explicit: don't add an npm dependency to a repo whose Docker
 * build uses `npm ci` unless the lockfile can actually be regenerated
 * correctly, and prefer a dependency-free solution when it can't — this
 * change was authored without a real `npm install` against this repo's
 * lockfile, so pulling in a PDF-rendering library (e.g. @react-pdf/renderer)
 * here would be exactly the thing that guidance warns against. HTML needs
 * zero new dependencies, emails natively, and is already the format every
 * other customer-facing document in this codebase uses (see email.ts). If
 * a literal PDF file is later required (e.g. for a customer portal download
 * button), that's an explicit follow-up: add the dependency with a real
 * `npm install` + committed lockfile update, not a hand-edited package.json.
 *
 * Source of truth: this reads Account + LedgerEntry rows directly — it does
 * not call Netcash or any other external system, and never should (see
 * claude/invoicing-statements-scope.md §0 in the Stor24 project for why).
 *
 * VAT: sums LedgerEntry.taxAmount across the included lines. As of this
 * writing billing-service.ts's runMonthlyBilling() does not populate
 * taxAmount when it posts rent charges, so a real invoice for a
 * rent-only account will currently show R0.00 VAT — that is accurate to
 * what's in the ledger, not a bug in this renderer, and is flagged as an
 * open decision in the scope doc (§6: is taxAmount meant to be populated
 * going forward, and does historical data need a backfill).
 *
 * Payment link: intentionally NOT wired to Netcash from this module. Pass
 * `payNowUrl` only once the Pay Now integration has cleared item #1 on
 * docs/STOR24_OUTSTANDING_TASKS.md (real credentials, proven callbacks,
 * business approval) — until then, leave it undefined and only the banking
 * details in the footer are shown as a payment option.
 */
import { BRAND, documentShellHtml, escapeHtml, formatZar } from "@/lib/finance/billing-document-brand";
import type { BillingDocumentCompanyDetails } from "@/lib/finance/billing-document-config";

export type InvoiceLedgerLine = {
  id: string;
  description: string;
  effectiveAt: Date;
  amount: number | string;
  taxAmount: number | string;
};

export type InvoiceRenderInput = {
  invoiceNumber: string;
  issueDate: Date;
  facilityName: string;
  company: BillingDocumentCompanyDetails;
  customerName: string;
  customerTaxNumber?: string;
  billingAddressLines?: string[];
  unitLabel?: string;
  accountNumber: string;
  currentBalance: number | string;
  lines: InvoiceLedgerLine[];
  payNowUrl?: string;
};

function formatDate(date: Date) {
  return date.toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
}

export function renderInvoiceHtml(input: InvoiceRenderInput): string {
  const subtotal = input.lines.reduce((sum, line) => sum + Number(line.amount) - Number(line.taxAmount), 0);
  const vatTotal = input.lines.reduce((sum, line) => sum + Number(line.taxAmount), 0);
  const grandTotal = input.lines.reduce((sum, line) => sum + Number(line.amount), 0);

  const rows = input.lines.map((line) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;color:${BRAND.ink};">${escapeHtml(line.description)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:13px;color:${BRAND.mutedSoft};white-space:nowrap;">${escapeHtml(formatDate(line.effectiveAt))}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;color:${BRAND.ink};text-align:right;white-space:nowrap;">${formatZar(line.amount)}</td>
    </tr>`).join("");

  const payNowBlock = input.payNowUrl
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:22px 0 4px;"><tr><td align="center">
        <a href="${escapeHtml(input.payNowUrl)}" target="_top" style="display:inline-block;background:${BRAND.accent};color:#ffffff;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px;text-decoration:none;">Pay now</a>
      </td></tr></table>`
    : "";

  const bankingLines = [
    input.company.banking?.bankName && `Bank: ${input.company.banking.bankName}`,
    input.company.banking?.accountName && `Account name: ${input.company.banking.accountName}`,
    input.company.banking?.accountNumber && `Account number: ${input.company.banking.accountNumber}`,
    input.company.banking?.branchCode && `Branch code: ${input.company.banking.branchCode}`,
    input.company.banking?.swift && `SWIFT: ${input.company.banking.swift}`,
  ].filter(Boolean) as string[];

  const bodyHtml = `
    <div style="margin-bottom:12px;color:${BRAND.accent};font-size:11px;line-height:1.4;font-weight:800;letter-spacing:2px;text-transform:uppercase;">Invoice</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-bottom:18px;">
      <tr>
        <td style="font-size:13px;color:${BRAND.muted};line-height:1.6;vertical-align:top;">
          ${escapeHtml(input.customerName)}<br>
          ${(input.billingAddressLines ?? []).map((line) => escapeHtml(line)).join("<br>")}
          ${input.customerTaxNumber ? `<br>VAT no: ${escapeHtml(input.customerTaxNumber)}` : ""}
        </td>
        <td style="font-size:13px;color:${BRAND.muted};line-height:1.6;text-align:right;vertical-align:top;">
          Invoice #: <strong style="color:${BRAND.ink};">${escapeHtml(input.invoiceNumber)}</strong><br>
          Date: ${escapeHtml(formatDate(input.issueDate))}<br>
          Facility: ${escapeHtml(input.facilityName)}<br>
          Account: ${escapeHtml(input.accountNumber)}
          ${input.unitLabel ? `<br>Unit: ${escapeHtml(input.unitLabel)}` : ""}
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
      <thead><tr>
        <td style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${BRAND.mutedSoft};padding-bottom:6px;border-bottom:2px solid ${BRAND.ink};">Description</td>
        <td style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${BRAND.mutedSoft};padding-bottom:6px;border-bottom:2px solid ${BRAND.ink};">Date</td>
        <td style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${BRAND.mutedSoft};padding-bottom:6px;border-bottom:2px solid ${BRAND.ink};text-align:right;">Amount</td>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:14px;">
      <tr><td style="text-align:right;padding:3px 0;font-size:13px;color:${BRAND.muted};">Subtotal</td><td style="text-align:right;padding:3px 0;font-size:13px;color:${BRAND.ink};width:120px;">${formatZar(subtotal)}</td></tr>
      <tr><td style="text-align:right;padding:3px 0;font-size:13px;color:${BRAND.muted};">VAT</td><td style="text-align:right;padding:3px 0;font-size:13px;color:${BRAND.ink};">${formatZar(vatTotal)}</td></tr>
      <tr><td style="text-align:right;padding:8px 0 0;font-size:16px;font-weight:900;color:${BRAND.ink};border-top:1px solid ${BRAND.line};">Total due</td><td style="text-align:right;padding:8px 0 0;font-size:16px;font-weight:900;color:${BRAND.ink};border-top:1px solid ${BRAND.line};">${formatZar(grandTotal)}</td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:${BRAND.mutedSoft};">Current account balance (including this invoice): <strong style="color:${BRAND.ink};">${formatZar(input.currentBalance)}</strong></p>
    ${payNowBlock}
    ${bankingLines.length ? `<div style="margin-top:18px;padding:14px 16px;background:${BRAND.bg};border-radius:12px;font-size:12px;color:${BRAND.muted};line-height:1.7;"><strong style="color:${BRAND.ink};">Bank transfer</strong><br>${bankingLines.map(escapeHtml).join("<br>")}</div>` : ""}
    ${input.company.registrationNumber || input.company.vatNumber ? `<p style="margin:16px 0 0;font-size:11px;color:${BRAND.mutedSoft};">${input.company.companyName ? escapeHtml(input.company.companyName) + " " : ""}${input.company.registrationNumber ? `Reg no: ${escapeHtml(input.company.registrationNumber)} ` : ""}${input.company.vatNumber ? `VAT no: ${escapeHtml(input.company.vatNumber)}` : ""}</p>` : ""}
  `;

  return documentShellHtml({
    title: `Invoice ${input.invoiceNumber}`,
    preheader: `Invoice ${input.invoiceNumber} — ${formatZar(grandTotal)} due.`,
    bodyHtml,
  });
}

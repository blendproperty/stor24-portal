// Deterministic application export policy. Never return matching content in findings.
export const DLP_POLICY_VERSION = "2026-10-01.1";
export const DLP_MAX_ROWS = 5000;
export const DLP_MAX_BYTES = 5 * 1024 * 1024;
export type DlpDecision = { allowed: boolean; classification: "confidential" | "restricted"; reasons: string[]; rowCount: number; policyVersion: string };
const exportableReports = new Set(["occupancy-revenue", "unit-availability", "move-activity", "lead-conversion", "rent-roll", "receivables-ageing", "collections-performance", "insurance-participation", "integration-health"]);
const restrictedField = /^(password|passwordhash|secret|clientsecret|apikey|accesstoken|refreshtoken|authtoken|authorization|privatekey|idnumber|identitynumber|passportnumber|bankaccount|bankaccountnumber|cardnumber|cvv|biometric|biometrictemplate)$/;
function luhn(value: string) {
  let sum = 0;
  for (let i = value.length - 1, alternate = false; i >= 0; i--, alternate = !alternate) {
    let digit = Number(value[i]);
    if (alternate) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0 && !/^(\d)\1+$/.test(value);
}
export function inspectReportExport(reportKey: string, rows: ReadonlyArray<Record<string, unknown>>): DlpDecision {
  const reasons = new Set<string>();
  if (!exportableReports.has(reportKey)) reasons.add("UNCLASSIFIED_REPORT");
  if (rows.length > DLP_MAX_ROWS) reasons.add("ROW_LIMIT");
  const serialized = JSON.stringify(rows);
  if (new TextEncoder().encode(serialized).byteLength > DLP_MAX_BYTES) reasons.add("SIZE_LIMIT");
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (restrictedField.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase()) && value !== null && value !== "") reasons.add("RESTRICTED_FIELD");
      // Current report contracts contain scalar values only. Unexpected objects
      // must never become a bypass for nested secrets or raw database records.
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) reasons.add("UNCLASSIFIED_CONTENT");
      if (typeof value !== "string") continue;
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk_live_|sk_test_|AKIA)[A-Za-z0-9]{12,}|\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i.test(value)) reasons.add("CREDENTIAL_PATTERN");
      for (const match of value.matchAll(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g)) {
        const digits = match[0].replace(/\D/g, "");
        if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) reasons.add("PAYMENT_CARD_PATTERN");
      }
    }
  }
  return { allowed: reasons.size === 0, classification: reasons.has("RESTRICTED_FIELD") || reasons.has("CREDENTIAL_PATTERN") || reasons.has("PAYMENT_CARD_PATTERN") ? "restricted" : "confidential", reasons: [...reasons].sort(), rowCount: rows.length, policyVersion: DLP_POLICY_VERSION };
}
export const dlpPrivateHeaders = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

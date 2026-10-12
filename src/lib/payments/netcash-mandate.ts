/** Netcash NIWS_NIF SOAP 1.1 contract, checked against live WSDL 2026-09-10.
 * This module creates/signals mandates ONLY. It never submits collections or
 * adds customers to the debit masterfile. Never trust the browser postback as proof.
 */
export const MANDATE_ENDPOINT = "https://ws.netcash.co.za/NIWS/NIWS_NIF.svc";
export type MandateTerms = {
  reference: string; agreementReference: string; agreementDate: string;
  firstName: string; surname: string; phone: string; email: string;
  amount: string; commencementMonth: number; debitDay: number;
  noticeDays: number; holiday: "PrecedingOrdinaryBusinessDay" | "VeryNextOrdinaryBusinessDay";
  correlation: string;
};
const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const decodeXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);|&#(\d+);|&#x([\da-f]+);/gi, (_, c: string, decimal: string, hex: string) => c ? ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[c.toLowerCase()]! : String.fromCodePoint(decimal ? Number(decimal) : parseInt(hex, 16)));
function tag(xml: string, name: string) {
  if (xml.length > 4_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("MANDATE_RESPONSE_INVALID");
  const matches = [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<\\/(?:[\\w-]+:)?${name}>`, "g"))];
  if (matches.length !== 1) throw new Error("MANDATE_RESPONSE_INVALID");
  return decodeXml(matches[0][1]).trim();
}
type Method = "AddMandate" | "RequestMandateData" | "RetrieveMandateData" | "BatchFileUpload" | "RequestFileUploadReport" | "RetrieveMandatePDF";
export function mandateEnvelope(method: Method, fields: Array<[string, string | number | boolean]>) {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${method} xmlns="http://tempuri.org/">${fields.map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`).join("")}</${method}></s:Body></s:Envelope>`;
}
export function validateMandateTerms(p: MandateTerms) {
  const date = new Date(`${p.agreementDate.slice(0, 4)}-${p.agreementDate.slice(4, 6)}-${p.agreementDate.slice(6, 8)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10).replaceAll("-", "") !== p.agreementDate) throw new Error("MANDATE_TERMS_INVALID");
  if (!/^[A-Za-z0-9-]{2,22}$/.test(p.reference) || !/^[A-Za-z0-9-]{2,50}$/.test(p.agreementReference) || !/^\d{8}$/.test(p.agreementDate)
    || !/^\d{1,8}\.\d{2}$/.test(p.amount) || Number(p.amount) <= 0
    || !Number.isInteger(p.commencementMonth) || p.commencementMonth < 1 || p.commencementMonth > 12
    || !Number.isInteger(p.debitDay) || p.debitDay < 1 || p.debitDay > 31
    || !Number.isInteger(p.noticeDays) || p.noticeDays < 1 || p.noticeDays > 60
    || !["PrecedingOrdinaryBusinessDay", "VeryNextOrdinaryBusinessDay"].includes(p.holiday)
    || !/^0\d{9}$/.test(p.phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)
    || !p.firstName.trim() || !p.surname.trim() || p.firstName.length > 100 || p.surname.length > 100
    || !/^[A-Za-z0-9_-]{32,50}$/.test(p.correlation)) throw new Error("MANDATE_TERMS_INVALID");
}
export function buildAddMandateEnvelope(key: string, p: MandateTerms) {
  validateMandateTerms(p);
  // Sequence/order follows xsd0; omitted banking fields are completed on Netcash.
  return mandateEnvelope("AddMandate", [
    ["ServiceKey", key], ["AccountReference", p.reference], ["MandateName", `${p.firstName} ${p.surname}`],
    ["MandateAmount", p.amount], ["IsConsumer", true], ["FirstName", p.firstName], ["Surname", p.surname],
    ["TradingName", ""], ["RegistrationNumber", ""], ["RegisteredName", ""], ["MobileNumber", p.phone],
    ["DebitFrequency", "Monthly"], ["CommencementMonth", p.commencementMonth], ["CommencementDay", String(p.debitDay).padStart(2, "0")],
    ["AgreementDate", p.agreementDate], ["AgreementReferenceNumber", p.agreementReference],
    ["CancellationNoticePeriod", p.noticeDays], ["PublicHolidayOption", p.holiday], ["Field1", p.correlation],
    ["AllowVariableDebitAmounts", false], ["EmailAddress", p.email], ["MandateActive", false],
    ["RequestAVS", false], ["IncludeDebiCheck", false], ["AddToMasterFile", false],
  ]);
}
export function safeMandateUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["short.surf", "mandate.netcash.co.za"].includes(url.hostname)) throw new Error("MANDATE_URL_INVALID");
  return url.toString();
}
export function safeMandatePdfUrl(value: string) {
  const url = new URL(value);
  // The authenticated PDF manifest's short.surf link redirects to the plural
  // Netcash mandates host. Keep document destinations explicit and separate
  // from signing URLs; never allow arbitrary hosts or credential URLs.
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["short.surf", "mandate.netcash.co.za", "mandates.netcash.co.za"].includes(url.hostname)) throw new Error("MANDATE_URL_INVALID");
  return url.toString();
}
export function parseAddMandateResponse(xml: string) {
  const code = tag(xml, "ErrorCode");
  if (code !== "000") throw new Error(["100", "200", "203"].includes(code) ? `MANDATE_PROVIDER_${code}` : "MANDATE_RESPONSE_INVALID");
  return safeMandateUrl(tag(xml, "MandateUrl"));
}
async function soap(method: Method, body: string, request: typeof fetch) {
  const response = await request(MANDATE_ENDPOINT, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: `"http://tempuri.org/INIWS_NIF/${method}"` }, body });
  if (!response.ok) throw new Error(`MANDATE_HTTP_${response.status}`);
  // Do not log XML: responses can contain account numbers and identity data.
  const xml = new TextDecoder().decode(await boundedBody(response, 4_000_000));
  if (xml.length > 4_000_000 || /<(?:[\w-]+:)?Fault\b|<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("MANDATE_RESPONSE_INVALID");
  return xml;
}
export async function boundedBody(response: Response, maximum: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("MANDATE_RESPONSE_INVALID");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error("MANDATE_RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function addHostedMandate(key: string, terms: MandateTerms, request: typeof fetch = fetch) {
  return parseAddMandateResponse(await soap("AddMandate", buildAddMandateEnvelope(key, terms), request));
}
export async function requestMandateData(key: string, request: typeof fetch = fetch) {
  const token = tag(await soap("RequestMandateData", mandateEnvelope("RequestMandateData", [["ServiceKey", key]]), request), "RequestMandateDataResult");
  if (!/^\d+(?:\.\d+){2,}$/.test(token)) throw new Error("MANDATE_REPORT_UNAVAILABLE");
  return token;
}
export async function retrieveMandateData(key: string, token: string, request: typeof fetch = fetch) {
  if (!/^\d+(?:\.\d+){2,}$/.test(token)) throw new Error("MANDATE_REPORT_UNAVAILABLE");
  return tag(await soap("RetrieveMandateData", mandateEnvelope("RetrieveMandateData", [["ServiceKey", key], ["FileToken", token]]), request), "RetrieveMandateDataResult");
}
export function assessMandateReport(report: string, expected: MandateTerms) {
  const lines = report.trim().split(/\r?\n/);
  if (!/^###BEGIN\t\d{8}$/.test(lines[0]) || lines.at(-1) !== "###END") throw new Error("MANDATE_REPORT_PENDING");
  const rows = lines.slice(1, -1).map(line => line.split("\t")).filter(row => row[1] === expected.reference);
  if (!rows.length) return { status: "AWAITING_SIGNATURE" as const, matched: false, reason: "MANDATE_REPORT_NOT_LISTED" };
  if (rows.length !== 1) throw new Error("MANDATE_REPORT_AMBIGUOUS");
  const r = rows[0];
  // Current NIWS export: 44 fields, CCYYMMDD commencement date and the
  // WSDL's holiday enum IDs 1=preceding / 2=next. Older documented exports
  // use a month and IDs 0/1. Select a format explicitly, never accept both
  // meanings for holiday ID1 within the same format.
  const dated = r.length === 44 && /^\d{8}$/.test(r[12]);
  const legacy = r.length >= 41 && r.length <= 43 && /^\d{1,2}$/.test(r[12]);
  const firstDate = expected.agreementDate.slice(0, 4) + String(expected.commencementMonth).padStart(2, "0") + String(expected.debitDay).padStart(2, "0");
  const pending = ["1", "2", "8", "9", "10", "11"].includes(r[0]);
  const missingBankDetails = dated && pending && r[21] === "0" && r[26] === "";
  // Observed current exports also use type 0 after bank signing. Require the
  // complete bank shape, not merely an accepted status or a numeric token.
  // Fields 23-27 are holder, account type, branch, filler and account number.
  const bankShape = Boolean(r[22]?.trim()) && ["1", "2", "3"].includes(r[23])
    && /^\d{6}$/.test(r[24]) && /^\d{4,11}$/.test(r[26]);
  // Match immutable commercial snapshot AND server-generated correlation, never
  // retain the bank/identity fields from this account-wide provider report.
  const checks: Record<string, boolean> = {
    FORMAT: dated || legacy,
    CORRELATION: r[30] === expected.correlation,
    AGREEMENT: r[15] === expected.agreementReference && r[14] === expected.agreementDate,
    AMOUNT: /^\d+(?:\.\d+)?$/.test(r[3]) && Number(r[3]) === Number(expected.amount),
    SCHEDULE: r[11] === "1" && (dated ? r[12] === firstDate : Number(r[12]) === expected.commencementMonth) && r[13] === String(expected.debitDay).padStart(2, "0"),
    NOTICE: Number(r[16]) === expected.noticeDays,
    HOLIDAY: r[17] === (expected.holiday === "VeryNextOrdinaryBusinessDay" ? dated ? "2" : "1" : dated ? "1" : "0"),
    BANK_TYPE: dated ? missingBankDetails || (["0", "1"].includes(r[21]) && bankShape) : r[21] === "1",
    FIXED_AMOUNT: r[40] === "0",
  };
  const failed = Object.entries(checks).find(([, valid]) => !valid);
  if (failed) return { status: "REVIEW_REQUIRED" as const, matched: false, reason: `MANDATE_REPORT_${failed[0]}_MISMATCH` };
  const statuses: Record<string, "SIGNED" | "EXPIRED" | "FAILED" | "DECLINED" | "REVIEW_REQUIRED" | "AWAITING_SIGNATURE"> = { "6": "SIGNED", "3": "EXPIRED", "4": "FAILED", "5": "DECLINED", "7": "REVIEW_REQUIRED" };
  const status = statuses[r[0]] ?? (pending ? "AWAITING_SIGNATURE" : "REVIEW_REQUIRED");
  return { status, matched: true, reason: status === "REVIEW_REQUIRED" ? r[0] === "7" ? "MANDATE_REPORT_DETAILS_CHANGED" : "MANDATE_REPORT_UNKNOWN_STATUS" : null };
}
export function verifyMandateReport(report: string, expected: MandateTerms) {
  return assessMandateReport(report, expected).status;
}
export function canRecheckMandate(m: { status: string; hostedUrl: string | null; failureCode: string | null }) {
  return m.status !== "CREATING" && (m.status !== "REVIEW_REQUIRED" || Boolean(m.hostedUrl && (!m.failureCode || m.failureCode.startsWith("MANDATE_REPORT_"))));
}

export async function requestMandatePdf(key: string, reference: string, vendor: string, date: string, request: typeof fetch = fetch) {
  if (!/^[A-Za-z0-9-]{2,22}$/.test(reference) || !/^[\da-f-]{36}$/i.test(key) || !/^[\da-f-]{36}$/i.test(vendor) || !/^\d{8}$/.test(date)) throw new Error("MANDATE_TERMS_INVALID");
  const file = `H\t${key}\t1\tRequestMandatePDF\t${reference}\t${date}\t${vendor}\nK\t101\nT\t${reference}\nF\t1\t0\t9999`;
  const token = tag(await soap("BatchFileUpload", mandateEnvelope("BatchFileUpload", [["ServiceKey", key], ["File", file]]), request), "BatchFileUploadResult");
  if (!/^\d+(?:\.\d+){2,}$/.test(token)) throw new Error("MANDATE_PDF_PENDING");
  return token;
}
export async function retrieveMandatePdf(key: string, token: string, reference: string, request: typeof fetch = fetch) {
  if (!/^\d+(?:\.\d+){2,}$/.test(token)) throw new Error("MANDATE_PDF_PENDING");
  const fields: Array<[string, string]> = [["ServiceKey", key], ["FileToken", token]];
  const load = tag(await soap("RequestFileUploadReport", mandateEnvelope("RequestFileUploadReport", fields), request), "RequestFileUploadReportResult");
  const loadLines = load.trim().split(/\r?\n/);
  const header = loadLines[0].split("\t");
  // Netcash uppercases batch titles in current six-field upload reports and
  // manifest headings. Only those titles are case-insensitive; the account
  // reference in the document row below remains an exact binding.
  if (![4, 6].includes(header.length) || header[0] !== "###BEGIN" || header[1]?.toUpperCase() !== reference.toUpperCase() || header[2] !== "SUCCESSFUL" || load.includes("###ERROR") || !loadLines.at(-1)?.startsWith("###END\t")) throw new Error("MANDATE_PDF_PENDING");
  const report = tag(await soap("RetrieveMandatePDF", mandateEnvelope("RetrieveMandatePDF", fields), request), "RetrieveMandatePDFResult");
  const rows = report.trim().split(/\r?\n/);
  const manifestHeader = rows[0].split("\t");
  if (manifestHeader.length !== 2 || manifestHeader[0] !== "###BEGIN" || manifestHeader[1]?.toUpperCase() !== reference.toUpperCase() || rows.at(-1) !== "###END" || rows.length !== 3) throw new Error("MANDATE_PDF_PENDING");
  const [returnedReference, link] = rows[1].split("\t");
  if (returnedReference !== reference) throw new Error("MANDATE_PDF_INVALID");
  let url = new URL(safeMandatePdfUrl(link));
  url.searchParams.set("PKey", key);
  const sessions = new Map<string, Map<string, string>>();
  // Download server-side. Never expose the documented PKey URL to browsers/logs.
  for (let hop = 0; hop < 4; hop++) {
    safeMandatePdfUrl(url.toString());
    const cookies = sessions.get(url.hostname);
    const cookie = cookies ? [...cookies].map(([name,value]) => `${name}=${value}`).join("; ") : "";
    const response = await request(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), cache: "no-store", ...(cookie ? { headers: { cookie } } : {}) });
    // Netcash authenticates the PKey request then redirects to the document
    // with a session cookie. Keep it only for this download and exact HTTPS
    // host; never forward Netcash cookies to short.surf or another host.
    if (["mandate.netcash.co.za", "mandates.netcash.co.za"].includes(url.hostname)) {
      const values = response.headers.getSetCookie();
      const jar = sessions.get(url.hostname) ?? new Map<string,string>();
      for (const value of values) {
        const pair = value.split(";",1)[0]; const equals = pair.indexOf("=");
        const name = pair.slice(0,equals); const content = pair.slice(equals+1);
        if (equals < 1 || !/^[A-Za-z0-9_.-]+$/.test(name) || /[\r\n]/.test(content)) continue;
        if (!content || /;\s*Max-Age=0(?:;|$)/i.test(value)) jar.delete(name); else jar.set(name,content);
      }
      sessions.set(url.hostname,jar);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); if (!location) throw new Error("MANDATE_PDF_INVALID");
      const next = new URL(location, url);
      // Current Netcash short links return a legacy HTTP document location.
      // This exact host supports verified HTTPS: upgrade before any request,
      // never send PKey over HTTP or broaden redirects to arbitrary hosts.
      if (next.protocol === "http:" && next.hostname === "mandates.netcash.co.za" && !next.port && !next.username && !next.password) next.protocol = "https:";
      safeMandatePdfUrl(next.toString());
      url = next; continue;
    }
    if (!response.ok) throw new Error("MANDATE_PDF_PENDING");
    const pdf = await boundedBody(response, 10_000_000);
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("MANDATE_PDF_INVALID");
    return pdf;
  }
  throw new Error("MANDATE_PDF_INVALID");
}

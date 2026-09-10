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
export function verifyMandateReport(report: string, expected: MandateTerms) {
  const lines = report.trim().split(/\r?\n/);
  if (!/^###BEGIN\t\d{8}$/.test(lines[0]) || lines.at(-1) !== "###END") throw new Error("MANDATE_REPORT_PENDING");
  const rows = lines.slice(1, -1).map(line => line.split("\t")).filter(row => row[1] === expected.reference);
  if (!rows.length) return "AWAITING_SIGNATURE" as const;
  if (rows.length !== 1) throw new Error("MANDATE_REPORT_AMBIGUOUS");
  const r = rows[0];
  // Match immutable commercial snapshot AND server-generated correlation, never
  // retain the bank/identity fields from this account-wide provider report.
  if (r.length < 41 || r[30] !== expected.correlation || r[15] !== expected.agreementReference
    || !/^\d+(?:\.\d+)?$/.test(r[3]) || Number(r[3]) !== Number(expected.amount)
    || r[11] !== "1" || Number(r[12]) !== expected.commencementMonth || r[13] !== String(expected.debitDay).padStart(2, "0")
    || r[14] !== expected.agreementDate || Number(r[16]) !== expected.noticeDays
    || r[17] !== (expected.holiday === "VeryNextOrdinaryBusinessDay" ? "1" : "0")
    || r[21] !== "1" || r[40] !== "0") return "REVIEW_REQUIRED" as const;
  return ({ "6": "SIGNED", "3": "EXPIRED", "4": "FAILED", "5": "DECLINED", "7": "REVIEW_REQUIRED" } as const)[r[0] as "6"] ?? "AWAITING_SIGNATURE";
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
  if (header[0] !== "###BEGIN" || header[1] !== reference || header[2] !== "SUCCESSFUL" || load.includes("###ERROR") || !loadLines.at(-1)?.startsWith("###END\t")) throw new Error("MANDATE_PDF_PENDING");
  const report = tag(await soap("RetrieveMandatePDF", mandateEnvelope("RetrieveMandatePDF", fields), request), "RetrieveMandatePDFResult");
  const rows = report.trim().split(/\r?\n/);
  if (rows[0] !== `###BEGIN\t${reference}` || rows.at(-1) !== "###END" || rows.length !== 3) throw new Error("MANDATE_PDF_PENDING");
  const [returnedReference, link] = rows[1].split("\t");
  if (returnedReference !== reference) throw new Error("MANDATE_PDF_INVALID");
  let url = new URL(safeMandateUrl(link));
  url.searchParams.set("PKey", key);
  // Download server-side. Never expose the documented PKey URL to browsers/logs.
  for (let hop = 0; hop < 4; hop++) {
    safeMandateUrl(url.toString());
    const response = await request(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); if (!location) throw new Error("MANDATE_PDF_INVALID");
      url = new URL(location, url); continue;
    }
    if (!response.ok) throw new Error("MANDATE_PDF_PENDING");
    const pdf = await boundedBody(response, 10_000_000);
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("MANDATE_PDF_INVALID");
    return pdf;
  }
  throw new Error("MANDATE_PDF_INVALID");
}

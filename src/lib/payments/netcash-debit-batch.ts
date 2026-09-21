/** Standard EFT compact batches. Upload acceptance is never proof of payment.
 * Contract: https://api.netcash.co.za/value-added-services/compact-debit/
 * Checked 2026-09-21. No bank data or provider authorisation is sent here.
 */
import { createHash } from "node:crypto";
import { boundedBody, MANDATE_ENDPOINT } from "./netcash-mandate";
export const debitConnectionFingerprint = (config: { environment: string; merchantAccount?: string; debitOrderServiceKey?: string }) => createHash("sha256").update(JSON.stringify([config.environment, config.merchantAccount, config.debitOrderServiceKey])).digest("hex");
export function validDebitDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function buildCompactDebitFile(key: string, vendor: string, name: string, date: string, rows: Array<{ reference: string; amount: number }>) {
  if (![key, vendor].every(s => /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s)) || !/^[A-Za-z0-9-]{1,50}$/.test(name) || !validDebitDate(date) || rows.length < 1 || rows.length > 500) throw new Error("DEBIT_FILE_INVALID");
  const references = new Set<string>(); let total = 0;
  const lines = rows.map(row => {
    const cents = Math.round(row.amount * 100);
    if (!/^[A-Za-z0-9-]{2,22}$/.test(row.reference) || references.has(row.reference) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 9999999999 || Math.abs(row.amount * 100 - cents) > .00001) throw new Error("DEBIT_FILE_INVALID");
    references.add(row.reference); total += cents;
    return `T\t${row.reference}\t${cents}`;
  });
  return [`H\t${key}\t1\tCompactTwoDay\t${name}\t${date.replaceAll("-", "")}\t${vendor}`, "K\t101\t162", ...lines, `F\t${rows.length}\t${total}\t9999`].join("\n");
}
const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
async function soap(method: "BatchFileUpload" | "RequestFileUploadReport", key: string, parameter: string, value: string, request: typeof fetch) {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${method} xmlns="http://tempuri.org/"><ServiceKey>${escapeXml(key)}</ServiceKey><${parameter}>${escapeXml(value)}</${parameter}></${method}></s:Body></s:Envelope>`;
  const response = await request(MANDATE_ENDPOINT, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000), headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: `"http://tempuri.org/INIWS_NIF/${method}"` }, body });
  if (!response.ok) throw new Error("DEBIT_PROVIDER_OUTCOME_UNKNOWN");
  const xml = (await boundedBody(response, 1_000_000)).toString();
  if (/<!DOCTYPE|<!ENTITY|<(?:[\w-]+:)?Fault\b/i.test(xml)) throw new Error("DEBIT_PROVIDER_OUTCOME_UNKNOWN");
  const matches = [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${method}Result(?:\\s[^>]*)?>([^<]*)<\\/(?:[\\w-]+:)?${method}Result>`, "g"))];
  if (matches.length !== 1) throw new Error("DEBIT_PROVIDER_OUTCOME_UNKNOWN");
  return matches[0][1].replace(/&(lt|gt|quot|apos|amp);|&#(\d+);/g, (_, c: string, d: string) => d ? String.fromCodePoint(Number(d)) : ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[c]!).trim();
}
export async function uploadDebitBatch(key: string, file: string, request: typeof fetch = fetch) {
  const result = await soap("BatchFileUpload", key, "File", file, request);
  if (["100", "101", "102", "200"].includes(result)) throw new Error(`DEBIT_UPLOAD_REJECTED_${result}`);
  if (!/^\d+(?:\.\d+){2,}$/.test(result)) throw new Error("DEBIT_PROVIDER_OUTCOME_UNKNOWN");
  return result;
}
export async function retrieveDebitLoadReport(key: string, token: string, request: typeof fetch = fetch) {
  if (!/^\d+(?:\.\d+){2,}$/.test(token)) throw new Error("DEBIT_REPORT_INVALID");
  return soap("RequestFileUploadReport", key, "FileToken", token, request);
}
export function parseDebitLoadReport(report: string, batchName: string, actionDate: string, total: number) {
  if (report === "FILE NOT READY") return "SUBMITTED" as const;
  const lines = report.trim().split(/\r?\n/); const header = lines[0].split("\t");
  if (header[0] !== "###BEGIN" || header[1] !== batchName || !lines.at(-1)?.startsWith("###END\t")) throw new Error("DEBIT_REPORT_INVALID");
  // Partial loads and malformed results must never free instructions for resubmission.
  if (header[2] !== "SUCCESSFUL" || lines.length !== 2 || header[5] !== actionDate.replaceAll("-", "") || !/^\d+(?:\.\d{1,2})?$/.test(header[4] ?? "") || Math.round(Number(header[4]) * 100) !== Math.round(total * 100)) return "REVIEW_REQUIRED" as const;
  return "ACCEPTED" as const;
}

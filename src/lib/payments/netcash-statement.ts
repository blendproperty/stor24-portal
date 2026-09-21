/** Full daily statement SOAP contract and WSDL verified 2026-09-21.
 * https://api.netcash.co.za/standard-integration/netcash-statement/
 * Read-only requests: never release funds, submit a debit or post a receipt.
 */
import { createHash } from "node:crypto";
import { boundedBody, MANDATE_ENDPOINT } from "./netcash-mandate";
export const merchantIdentity = (organisationId: string, environment: string, merchant: string) => createHash("sha256").update(JSON.stringify([organisationId, environment, merchant])).digest("hex");
const escape = (v: string) => v.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
async function soap(method: string, key: string, parameter: string, value: string, request: typeof fetch) {
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(key)) throw new Error("SETTLEMENT_CONFIG");
  const response = await request(MANDATE_ENDPOINT, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000), headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: `"http://tempuri.org/INIWS_NIF/${method}"` }, body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${method} xmlns="http://tempuri.org/"><ServiceKey>${escape(key)}</ServiceKey><${parameter}>${escape(value)}</${parameter}></${method}></s:Body></s:Envelope>` });
  if (!response.ok) throw new Error("SETTLEMENT_PROVIDER");
  const xml = (await boundedBody(response, 1_000_000)).toString();
  if (/<!DOCTYPE|<!ENTITY|<(?:[\w-]+:)?Fault\b/i.test(xml)) throw new Error("SETTLEMENT_PROVIDER");
  const matches = [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${method}Result(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${method}Result>`, "g"))];
  if (matches.length !== 1) throw new Error("SETTLEMENT_PROVIDER");
  const valueText = matches[0][1];
  if (valueText.includes("<") && !/^<!\[CDATA\[[\s\S]*\]\]>$/.test(valueText)) throw new Error("SETTLEMENT_PROVIDER");
  const result = valueText.startsWith("<![CDATA[") ? valueText.slice(9, -3) : valueText.replace(/&(lt|gt|quot|apos|amp);|&#(\d+);|&#x([a-f\d]+);/gi, (_, c: string, d: string, h: string) => c ? ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[c.toLowerCase()]! : String.fromCodePoint(d ? Number(d) : parseInt(h, 16)));
  if (["100", "101", "102", "200"].includes(result.trim())) throw new Error(`SETTLEMENT_PROVIDER_${result.trim()}`);
  return result;
}
export async function requestDailyStatement(key: string, date: string, request: typeof fetch = fetch) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("SETTLEMENT_DATE");
  const result = (await soap("RequestMerchantStatement", key, "FromActionDate", date.replaceAll("-", ""), request)).trim();
  if (!/^\d{10,30}$/.test(result)) throw new Error("SETTLEMENT_PROVIDER"); return result;
}
export async function retrieveDailyStatement(key: string, token: string, request: typeof fetch = fetch) {
  if (!/^\d{10,30}$/.test(token)) throw new Error("SETTLEMENT_PROVIDER");
  const result = await soap("RetrieveMerchantStatement", key, "PollingId", token, request);
  return result.trim() === "FILE NOT READY" ? null : result;
}

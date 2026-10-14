/** PayNow.svc SOAP 1.1, checked against the live WSDL on 14 October 2026.
 * Mutating calls: the caller must durably claim one approved attempt first.
 * A successful response is provider acceptance, never settlement or a receipt.
 * https://ws.netcash.co.za/PayNow/PayNow.svc?singleWsdl
 */
import { boundedBody } from "./netcash-mandate";
import { payNowSoapResult } from "./netcash-paynow-response";

export const PAYNOW_SOAP_ENDPOINT = "https://ws.netcash.co.za/PayNow/PayNow.svc";
type Method = "CreateInvoice" | "UpdateSubscriptions" | "DeleteSubscription" | "RequestCreditCardRefund";
type Field = [string, string | number | boolean];
const guid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
function reference(value: string) {
  if (!/^[A-Za-z0-9_-]{1,25}$/.test(value)) throw Error("PAYNOW_REFERENCE_INVALID");
  return value;
}
function money(value: string) {
  if (!/^\d{1,6}\.\d{2}$/.test(value) || Number(value) <= 0) throw Error("PAYNOW_AMOUNT_INVALID");
  return value;
}
function calendarDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error("PAYNOW_DATE_INVALID");
  return value.replaceAll("-", "");
}
export function payNowSoapEnvelope(method: Method, fields: Field[]) {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${method} xmlns="http://tempuri.org/">${fields.map(([name, value]) => `<${name}>${escape(String(value))}</${name}>`).join("")}</${method}></s:Body></s:Envelope>`;
}
async function call(method: Method, fields: Field[], request: typeof fetch) {
  let response: Response;
  try {
    response = await request(PAYNOW_SOAP_ENDPOINT, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000), headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: `"http://tempuri.org/IPayNow/${method}"` }, body: payNowSoapEnvelope(method, fields) });
    if (!response.ok) throw Error("PAYNOW_OUTCOME_UNCERTAIN");
    return payNowSoapResult((await boundedBody(response, 64000)).toString(), method);
  } catch {
    // Never expose response bodies/keys or automatically replay a possible mutation.
    throw Error("PAYNOW_OUTCOME_UNCERTAIN");
  }
}
function key(value: string) {
  if (!guid.test(value)) throw Error("PAYNOW_CONFIGURATION_REQUIRED");
  return value;
}
function acceptedCode(value: string) {
  if (value === "000") return { providerAccepted: true as const };
  if (["100", "103", "310", "311", "313", "314", "315"].includes(value)) throw Error(`PAYNOW_REJECTED_${value}`);
  throw Error("PAYNOW_OUTCOME_UNCERTAIN");
}
export type PayNowSubscriptionChange = { originalReference: string; cycles: number; startDate: string; monthlyAmount: string; active: boolean };
export function subscriptionChangeFields(serviceKey: string, input: PayNowSubscriptionChange): Field[] {
  if (!Number.isInteger(input.cycles) || input.cycles < 1 || input.cycles > 999 || typeof input.active !== "boolean") throw Error("PAYNOW_SUBSCRIPTION_INVALID");
  return [["M1", key(serviceKey)], ["P2", reference(input.originalReference)], ["M17", input.cycles], ["M18", 1], ["M19", calendarDate(input.startDate)], ["M20", money(input.monthlyAmount)], ["Active", input.active]];
}
export async function updatePayNowSubscription(serviceKey: string, input: PayNowSubscriptionChange, request: typeof fetch = fetch) {
  return acceptedCode(await call("UpdateSubscriptions", subscriptionChangeFields(serviceKey, input), request));
}
export async function deletePayNowSubscription(serviceKey: string, originalReference: string, request: typeof fetch = fetch) {
  return acceptedCode(await call("DeleteSubscription", [["M1", key(serviceKey)], ["P2", reference(originalReference)]], request));
}
export async function requestPayNowRefund(serviceKey: string, transactionId: number, amount: string, request: typeof fetch = fetch) {
  if (!Number.isInteger(transactionId) || transactionId < 1 || transactionId > 2147483647) throw Error("PAYNOW_REFUND_TRANSACTION_INVALID");
  return acceptedCode(await call("RequestCreditCardRefund", [["M1", key(serviceKey)], ["TransactionId", transactionId], ["amount", money(amount)]], request));
}
export type PayNowInvoiceRequest = { reference: string; description: string; amount: string; email?: string; mobile?: string; subscriptionTemplateId?: number; extra1?: string; extra2?: string; extra3?: string; returnData?: string };
export function invoiceRequestFields(serviceKey: string, vendorKey: string, input: PayNowInvoiceRequest): Field[] {
  if (!input.description.trim() || input.description.length > 50 || /[\x00-\x1f]/.test(input.description)) throw Error("PAYNOW_DESCRIPTION_INVALID");
  if (input.email && (input.email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) throw Error("PAYNOW_RECIPIENT_INVALID");
  if (input.mobile && !/^0\d{9}$/.test(input.mobile)) throw Error("PAYNOW_RECIPIENT_INVALID");
  if (input.subscriptionTemplateId !== undefined && (!Number.isInteger(input.subscriptionTemplateId) || input.subscriptionTemplateId < 1 || input.subscriptionTemplateId > 2147483647)) throw Error("PAYNOW_TEMPLATE_INVALID");
  const extras = [input.extra1 ?? "", input.extra2 ?? "", input.extra3 ?? "", input.returnData ?? ""];
  if (extras.some((value, i) => value.length > [999, 50, 50, 100][i] || /[\x00-\x1f]/.test(value))) throw Error("PAYNOW_EXTRA_INVALID");
  // No provider email, SMS, push, variable amount or token replay. The reviewed UI
  // owns delivery; merchant-hosted enrollment owns card credentials.
  const fields: Field[] = [["M1", key(serviceKey)], ["M2", key(vendorKey)], ["Amount", money(input.amount)], ["P2", reference(input.reference)], ["P3", input.description], ["M9", input.email ?? ""], ["M4", extras[0]], ["M5", extras[1]], ["M6", extras[2]], ["M10", extras[3]], ["IgnoreAmount", false], ["M11", input.mobile ?? ""], ["M12", false], ["M13", false], ["M14", input.subscriptionTemplateId !== undefined], ["SendPushNotification", false], ["Budget", false]];
  if (input.subscriptionTemplateId !== undefined) fields.push(["M27", input.subscriptionTemplateId]);
  return fields;
}
export async function createPayNowInvoiceRequest(serviceKey: string, vendorKey: string, input: PayNowInvoiceRequest, request: typeof fetch = fetch) {
  const value = await call("CreateInvoice", invoiceRequestFields(serviceKey, vendorKey, input), request);
  if (/^\d+$/.test(value)) acceptedCode(value);
  if (!value.startsWith("<") || /<!DOCTYPE|<!ENTITY/i.test(value)) throw Error("PAYNOW_OUTCOME_UNCERTAIN");
  // Private provider XML must be validated by the source-bound caller, encrypted
  // at rest and projected as safe URLs/text. Never send it as HTML to the client.
  return value;
}

import { z } from "zod";
import { dateKey } from "@/lib/collections-policy";
export const reference = z.string().trim().min(5).max(200);
export function units(value: string): bigint {
  if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(value)) throw new Error("SETTLEMENT_AMOUNT");
  const negative = value.startsWith("-"), [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, "0"))) * (negative ? -BigInt(1) : BigInt(1));
}
export function amount(value: bigint) { const n = value < 0 ? -value : value; return `${value < 0 ? "-" : ""}${n / BigInt(10000)}.${(n % BigInt(10000)).toString().padStart(4, "0")}`; }
const date = (value: string) => dateKey.parse(/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value);
const receipts = new Set(["PNC", "PNP", "PNM", "PNE", "PIS", "PVC", "TDD", "SDD", "TDC", "SDC", "DCS", "PQR"]);
const returns = new Set(["DRU", "DCD", "DCU", "PND", "PNR", "PNQ", "PNZ", "PVR", "PVD", "PIR", "PNX", "DRC"]);
export function lineKind(code: string, signed: bigint) {
  if (receipts.has(code) && signed > 0) return "RECEIPT";
  if (returns.has(code) && signed < 0) return "RETURN";
  if (["BTR", "BRT", "RTR"].includes(code) && signed < 0) return "PAYOUT";
  if (["BTU", "BRR", "RRR", "CRJ"].includes(code) && signed > 0) return "BANK_RETURN";
  if (["NSF", "VAT", "INP"].includes(code) && signed <= 0) return "FEE";
  if (receipts.has(code) || returns.has(code) || ["BTR", "BRT", "RTR", "BTU", "BRR", "RRR", "CRJ", "NSF", "VAT", "INP"].includes(code)) throw new Error("SETTLEMENT_DIRECTION");
  return "OTHER";
}
export type StatementLineInput = { transactionId: string; date: string; code: string; description: string; amount: string; vat: string; extras: string[]; kind: string };
export function parseDailyStatement(raw: string, expectedDate: string) {
  dateKey.parse(expectedDate);
  if (raw.length > 500000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) throw new Error("SETTLEMENT_FORMAT");
  const rows = raw.replace(/^\uFEFF/, "").replace(/(?:\r?\n)+$/, "").split(/\r?\n/);
  if (rows.length < 2 || rows.length > 502 || rows.some(r => !r)) throw new Error("SETTLEMENT_FORMAT");
  const parsed = rows.map((r, index) => {
    const fields = r.split("\t");
    if (fields.length < 7 || fields.length > 10 || fields.some(s => s.length > 500)) throw new Error("SETTLEMENT_FORMAT");
    const [d, code, id, description, value, sign, tax, ...extra] = fields;
    const boundary = index === 0 || index === rows.length - 1;
    if (date(d) !== expectedDate || !/^[A-Z]{3}$/.test(code) || !/^\d{1,30}$/.test(id) || !["+", "-"].includes(sign) || !description.trim()) throw new Error("SETTLEMENT_FORMAT");
    // Negative boundary amounts appear in Netcash's example; never double-apply a negative sign.
    if (value.startsWith("-") && (!boundary || sign !== "+")) throw new Error("SETTLEMENT_AMOUNT");
    const signed = units(value) * (sign === "-" ? -BigInt(1) : BigInt(1)), vat = units(tax);
    if (vat < 0) throw new Error("SETTLEMENT_AMOUNT");
    return { transactionId: id, date: expectedDate, code, description, amount: amount(signed), vat: amount(vat), extras: [...extra, "", "", ""].slice(0, 3), kind: lineKind(code, signed) };
  });
  if (parsed[0].code !== "OBL" || parsed.at(-1)!.code !== "CBL" || parsed[0].transactionId !== "0" || parsed.at(-1)!.transactionId !== "0") throw new Error("SETTLEMENT_FORMAT");
  const lines = parsed.slice(1, -1), ids = new Set<string>();
  for (const l of lines) { if (["OBL", "CBL"].includes(l.code) || l.transactionId === "0" || ids.has(l.transactionId)) throw new Error("SETTLEMENT_DUPLICATE"); ids.add(l.transactionId); }
  const opening = units(parsed[0].amount), closing = units(parsed.at(-1)!.amount), movement = lines.reduce((s, l) => s + units(l.amount), BigInt(0));
  if (opening + movement !== closing) throw new Error("SETTLEMENT_BALANCE");
  return { date: expectedDate, opening: amount(opening), closing: amount(closing), movement: amount(movement), lines };
}
/** Normalised bank extract, not a guessed native-bank format. Bank IDs must identify original statement rows. */
export function parseBankCsv(raw: string) {
  if (raw.length > 500000) throw new Error("SETTLEMENT_FORMAT");
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, afterQuote = false;
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') { quoted = false; afterQuote = true; } else cell += c; }
    else if (c === "," || c === "\n") { row.push(cell); cell = ""; afterQuote = false; if (c === "\n") { rows.push(row); row = []; } }
    else if (c === '"' && cell === "" && !afterQuote) quoted = true;
    else { if (afterQuote || c === '"') throw new Error("SETTLEMENT_FORMAT"); cell += c; }
  }
  if (quoted) throw new Error("SETTLEMENT_FORMAT");
  if (cell || row.length || afterQuote) { row.push(cell); rows.push(row); }
  if (rows.shift()?.join(",") !== "transaction_id,date,amount,reference" || !rows.length || rows.length > 500) throw new Error("SETTLEMENT_FORMAT");
  const ids = new Set<string>();
  return rows.map(r => {
    if (r.length !== 4 || r.some(v => /[\r\n\t\x00-\x1f]/.test(v)) || !/^[\w .:/-]{1,100}$/.test(r[0]) || !r[3].trim() || r[3].length > 200 || ids.has(r[0])) throw new Error("SETTLEMENT_FORMAT");
    ids.add(r[0]); const n = units(r[2]); if (!n) throw new Error("SETTLEMENT_AMOUNT");
    return { transactionId: r[0], date: date(r[1]), amount: amount(n), reference: r[3] };
  });
}
const id = z.string().cuid(), revision = z.number().int().nonnegative();
export const importStatementSchema = z.object({ connectionId: id, date: dateKey, raw: z.string().max(500000), sourceReference: reference });
export const settlementActionSchema = z.discriminatedUnion("action", [
  importStatementSchema.extend({ action: z.literal("preview") }).strict(),
  importStatementSchema.extend({ action: z.literal("import"), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("request"), connectionId: id, date: dateKey }).strict(),
  z.object({ action: z.literal("retrieve"), ticket: z.string().max(4000) }).strict(),
  z.object({ action: z.literal("bank-import"), alias: z.string().trim().min(3).max(80), environment: z.enum(["live", "sandbox"]), raw: z.string().max(500000), sourceReference: reference, confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("resolve"), id, revision, lineId: id, targetId: id.nullable(), reference, merchantConfirmed: z.boolean().default(false), requestKey: z.string().uuid() }).strict(),
  z.object({ action: z.enum(["approve", "reopen", "void"]), id, revision, reference, confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("balance"), connectionId: id, observedDate: dateKey, current: z.string(), available: z.string(), reference, confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("void-bank"), id, reference, confirm: z.literal(true) }).strict(),
]);
export type SettlementAction = z.infer<typeof settlementActionSchema>;

import { db } from "@/lib/db";
import { boundedBody } from "@/lib/payments/netcash-mandate";

// Browser form return, NOT a trusted webhook. Ignore success, bank data, PDFs
// and all other posted fields. Only provider report reconciliation can sign.
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response(null, { status: 415 });
  let raw: string;
  try { raw = new TextDecoder().decode(await boundedBody(new Response(request.body), 32_768)); }
  catch { return new Response(null, { status: 413 }); }
  const data = new URLSearchParams(raw);
  const reference = data.get("AccountRef"); const correlation = data.get("Field1");
  if (!reference || !correlation || !/^[A-Za-z0-9-]{2,22}$/.test(reference) || !/^[A-Za-z0-9_-]{32,50}$/.test(correlation)) return new Response(null, { status: 400 });
  const mandate = await db.publicDebitMandate.findUnique({ where: { reference }, include: { lease: { select: { signingToken: true } } } });
  if (!mandate || mandate.correlation !== correlation) return new Response(null, { status: 400 });
  return new Response(null, { status: 303, headers: { location: `https://stor4.srv938083.hstgr.cloud/book/debit-order/${encodeURIComponent(mandate.lease.signingToken)}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

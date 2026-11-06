import { createHash, timingSafeEqual } from "node:crypto";
import { runNextMonthInvoices } from "@/lib/next-month-invoice-run";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const key = request.headers.get("x-cron-key"), expected = process.env.NEXT_MONTH_INVOICING_KEY_SHA256;
  if (!key || !expected || !/^[a-f0-9]{64}$/.test(expected)) return Response.json({ error: { code: "BILLING_CRON_NOT_CONFIGURED" } }, { status: 503 });
  const actual = createHash("sha256").update(key).digest("hex");
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return Response.json({ error: { code: "INVALID_SIGNATURE" } }, { status: 401 });
  try { const data = await runNextMonthInvoices(); return Response.json({ data }, { status: data.exceptions.length ? 409 : 200, headers: { "cache-control": "private, no-store" } }); }
  catch (error) { const disabled = error instanceof Error && error.message === "BILLING_SCHEDULE_DISABLED"; return Response.json({ error: { code: disabled ? "BILLING_SCHEDULE_DISABLED" : "INTERNAL_ERROR" } }, { status: disabled ? 409 : 500 }); }
}

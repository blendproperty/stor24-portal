import { createHash, timingSafeEqual } from "node:crypto";
import { runMonthlyBilling } from "@/lib/billing-service";
import { currentBillingPeriod } from "@/lib/monthly-billing-policy";

// Triggered by an external cron job on the VPS (day 1 of each month), not
// by a logged-in staff member — so this authenticates via a shared secret
// header rather than session/permission checks, the same pattern used by
// src/app/api/v1/webhooks/inbound/[provider]/route.ts.
//
// VPS crontab entry (add manually — not something this app can install):
//   0 2 1 * * curl -sf -X POST https://<host>/api/v1/billing/run-monthly \
//     -H "x-cron-key: <the raw BILLING_CRON_SECRET value>" \
//     -H "Content-Type: application/json" -d '{}'
//
// The env var BILLING_CRON_SECRET_SHA256 stores only the SHA-256 hash of
// that raw key (see .env.example) — the raw key itself only ever lives in
// the crontab command / secrets manager, never in this app's config.

export const dynamic = "force-dynamic";

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function currentPeriod() {
  return currentBillingPeriod();
}

export async function POST(request: Request) {
  const presentedKey = request.headers.get("x-cron-key");
  const configuredHash = process.env.BILLING_CRON_SECRET_SHA256;
  if (!presentedKey || !configuredHash) {
    return Response.json({ error: { code: "BILLING_CRON_NOT_CONFIGURED", message: "Billing cron key is not configured." } }, { status: 503 });
  }
  const presentedHash = createHash("sha256").update(presentedKey).digest("hex");
  if (!secureEqual(presentedHash, configuredHash)) {
    return Response.json({ error: { code: "INVALID_SIGNATURE", message: "Billing cron authentication failed." } }, { status: 401 });
  }

  let period: string | undefined;
  try {
    const body = await request.json();
    if (body && typeof body.period === "string" && body.period.trim()) period = body.period.trim();
  } catch {
    // Empty or non-JSON body is fine — falls back to the current period.
  }

  try {
    const summary = await runMonthlyBilling(period ?? currentPeriod());
    return Response.json({ data: summary }, { status: summary.exceptions.length ? 409 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const status = message === "INVALID_PERIOD" ? 422 : message === "BILLING_AUTOMATION_DISABLED" ? 409 : 500;
    return Response.json({ error: { code: message, message: status === 500 ? "The request could not be completed." : message } }, { status });
  }
}

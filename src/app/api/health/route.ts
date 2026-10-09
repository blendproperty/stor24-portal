import { db } from "@/lib/db";
import { DLP_POLICY_VERSION } from "@/lib/dlp-policy";
import { expiryWorkerHealth } from "@/lib/merchandise-expiry-worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await db.$queryRaw`SELECT 1`;
    const merchandiseExpiry = expiryWorkerHealth();
    const healthy = merchandiseExpiry.status !== "degraded";
    return Response.json({ service: "stor24-crm", status: healthy ? "ok" : "degraded", database: "ok", merchandiseExpiry, checkedAt, dataProtectionPolicy: DLP_POLICY_VERSION }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ service: "stor24-crm", status: "degraded", database: "unavailable", checkedAt }, { status: 503 });
  }
}

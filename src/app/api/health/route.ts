import { db } from "@/lib/db";
import { DLP_POLICY_VERSION } from "@/lib/dlp-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ service: "stor24-crm", status: "ok", database: "ok", checkedAt, dataProtectionPolicy: DLP_POLICY_VERSION });
  } catch {
    return Response.json({ service: "stor24-crm", status: "degraded", database: "unavailable", checkedAt }, { status: 503 });
  }
}

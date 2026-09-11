import { createHash, timingSafeEqual } from "node:crypto";
import { expireMerchandiseOrders } from "@/lib/merchandise-order-settlement";

export const dynamic = "force-dynamic";

/** Dedicated worker credential; never accepts a tenant or staff session as authority. */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const configured = process.env.MERCHANDISE_CRON_SECRET_SHA256;
  if (!configured || !/^[a-f0-9]{64}$/i.test(configured)) {
    return Response.json({ error: "WORKER_NOT_CONFIGURED" }, { status: 503, headers });
  }
  const presented = request.headers.get("x-cron-key");
  if (!presented || presented.length > 4096) {
    return Response.json({ error: "UNAUTHORISED" }, { status: 401, headers });
  }
  const digest = createHash("sha256").update(presented).digest();
  if (!timingSafeEqual(digest, Buffer.from(configured, "hex"))) {
    return Response.json({ error: "UNAUTHORISED" }, { status: 401, headers });
  }
  try {
    // Continue releasing existing holds even when new checkout creation is disabled.
    const expired = await expireMerchandiseOrders();
    return Response.json({ data: { expired } }, { headers });
  } catch {
    // Non-success makes scheduler monitoring/retry mandatory, not a silent success.
    return Response.json({ error: "EXPIRY_REVIEW_REQUIRED" }, { status: 503, headers });
  }
}

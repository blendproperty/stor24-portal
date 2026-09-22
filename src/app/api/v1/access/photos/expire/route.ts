import { createHash, timingSafeEqual } from "node:crypto";
import { expireFacialPhotos } from "@/lib/facial-photo-service";
import { tenantPrivateHeaders as headers } from "@/lib/tenant-portal-response";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const expected = process.env.FACIAL_PHOTO_CRON_SECRET_SHA256;
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return Response.json({ error: "WORKER_NOT_CONFIGURED" }, { status: 503, headers });
  const supplied = request.headers.get("x-cron-key");
  if (!supplied || supplied.length > 4096 || !timingSafeEqual(createHash("sha256").update(supplied).digest(), Buffer.from(expected, "hex"))) return Response.json({ error: "UNAUTHORISED" }, { status: 401, headers });
  try { return Response.json({ data: { expired: await expireFacialPhotos() } }, { headers }); }
  catch { return Response.json({ error: "RETENTION_REVIEW_REQUIRED" }, { status: 503, headers }); }
}

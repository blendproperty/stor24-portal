import { timingSafeEqual } from "node:crypto";
import { processArrearsReviewSchedules } from "@/lib/collections-service";

export async function POST(request: Request) {
  const secret = process.env.ARREARS_REVIEW_WORKER_KEY ?? "", expected = `Bearer ${secret}`, presented = request.headers.get("authorization") ?? "";
  const headers = { "cache-control": "private, no-store" };
  if (secret.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(presented) || !timingSafeEqual(Buffer.from(expected), Buffer.from(presented))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try { return Response.json({ data: await processArrearsReviewSchedules() }, { headers }); }
  catch { return Response.json({ error: "Internal review evaluation is held. Check current plan, authority and source evidence." }, { status: 409, headers }); }
}

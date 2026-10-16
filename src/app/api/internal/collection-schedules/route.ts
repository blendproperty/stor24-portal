import { timingSafeEqual } from "node:crypto";
import { processCollectionSchedules } from "@/lib/collection-schedule-worker";
export async function POST(request: Request) {
  const secret = process.env.COLLECTION_SCHEDULE_WORKER_KEY ?? "", expected = `Bearer ${secret}`, presented = request.headers.get("authorization") ?? "";
  const headers = { "cache-control": "private, no-store" };
  if (secret.length < 32 || Buffer.byteLength(expected) !== Buffer.byteLength(presented) || !timingSafeEqual(Buffer.from(expected), Buffer.from(presented))) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try { return Response.json({ data: await processCollectionSchedules() }, { headers }); }
  catch { return Response.json({ error: "Scheduled run held. Review current source and durable delivery records before continuing." }, { status: 409, headers }); }
}

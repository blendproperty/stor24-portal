import { timingSafeEqual } from "node:crypto";
import { processStaffEventEmail } from "@/lib/staff-event-email-worker";

export async function POST(request: Request) {
  const secret = process.env.STAFF_EVENT_EMAIL_WORKER_KEY ?? "", presented = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (secret.length < 32 || Buffer.byteLength(presented) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(presented), Buffer.from(expected))) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  try { return Response.json({ data: await processStaffEventEmail() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return Response.json({ error: "Worker held. Investigate source and durable claims before another invocation." }, { status: 409, headers: { "Cache-Control": "private, no-store" } }); }
}

import { z } from "zod";
import { authErrorResponse } from "@/lib/auth-guards";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { readInvoiceSchedule, saveInvoiceSchedule } from "@/lib/invoice-schedule";
export async function GET(request: Request) {
  try { const facilityId = z.string().cuid().parse(new URL(request.url).searchParams.get("facilityId")); const scope = await requirePermissionScope("billing.view", facilityId); return Response.json({ data: await readInvoiceSchedule(scope, facilityId) }, { headers: { "cache-control": "private, no-store" } }); } catch (error) { return authErrorResponse(error); }
}
export async function POST(request: Request) {
  try { if (!sameOrigin(request)) throw new Error("FORBIDDEN"); const body = z.object({ facilityId: z.string().cuid(), date: z.iso.date() }).strict().parse(await request.json()); const scope = await requirePermissionScope("billing.manage", body.facilityId); return Response.json({ data: await saveInvoiceSchedule(scope, body.facilityId, { date: body.date }) }, { headers: { "cache-control": "private, no-store" } }); }
  catch (error) { if (error instanceof Error && error.message === "BILLING_SCHEDULE_DATE_INVALID") return Response.json({ error: { message: "Choose today or a later date in this month." } }, { status: 422 }); return authErrorResponse(error); }
}

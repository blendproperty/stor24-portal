import { apiError } from "@/lib/api";
import { bulkLeadCancelSchema, cancelTestLeads } from "@/lib/bulk-lead-cancel-service";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const visible = await requirePermissionScope("leads.view");
    const managed = await requirePermissionScope("leads.manage");
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: { message: "Check the selected enquiries." } }, { status: 422 }); }
    const input = bulkLeadCancelSchema.safeParse(body);
    if (!input.success) return Response.json({ error: { message: "Select between 1 and 100 different enquiries and confirm they are tests." } }, { status: 422 });
    const scope = { ...managed,
      unrestrictedFacilities: visible.unrestrictedFacilities && managed.unrestrictedFacilities,
      facilityIds: managed.unrestrictedFacilities ? visible.facilityIds : visible.unrestrictedFacilities ? managed.facilityIds : managed.facilityIds.filter(id => visible.facilityIds.includes(id)),
    };
    return Response.json({ data: await cancelTestLeads(scope, input.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "CONFLICT") return Response.json({ error: { message: "Nothing was changed. An enquiry changed or is not eligible for this action. Reload and review your selection." } }, { status: 409 });
    if (error instanceof Error && error.message === "LEAD_BOOKING_STAGE") return Response.json({ error: { message: "Nothing was changed. A selected enquiry has a booking or tenancy. Manage it through Reservations and Move-in first." } }, { status: 409 });
    if (error instanceof Error && error.message === "TRAINING_LEAD") return Response.json({ error: { message: "Nothing was changed. The shared training balance enquiry must be kept for staff training access." } }, { status: 409 });
    return apiError(error);
  }
}

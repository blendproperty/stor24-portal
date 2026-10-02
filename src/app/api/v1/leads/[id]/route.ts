import { db } from "@/lib/db";
import { leadUpdateSchema, updateLead } from "@/lib/leads-workspace-service";
import { requirePermissionScope, facilityWhere } from "@/lib/scope";
import { apiError } from "@/lib/api";
import { sameOrigin } from "@/lib/request-security";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const visible = await requirePermissionScope("leads.view");
    const { id } = await context.params;
    const lead = await db.lead.findFirst({ where: { id, facility: facilityWhere(visible) }, select: { facilityId: true } });
    if (!lead) throw new Error("NOT_FOUND");
    const scope = await requirePermissionScope("leads.manage", lead.facilityId);
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: { message: "Check the lead details." } }, { status: 422 }); }
    const input = leadUpdateSchema.safeParse(body);
    if (!input.success) return Response.json({ error: { message: "Check the lead details." } }, { status: 422 });
    return Response.json({ data: await updateLead(scope, id, input.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "CONFLICT") return Response.json({ error: { message: "This enquiry changed while you were editing. Refresh and review the saved details before trying again." } }, { status: 409 });
    if (error instanceof Error && error.message === "LEAD_BOOKING_STAGE") return Response.json({ error: { message: "This lead has a live booking. Manage its stage through Reservations and Move-in." } }, { status: 409 });
    return apiError(error);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requirePermissionScope("leads.view"); const { id } = await context.params;
    if (!await db.lead.findFirst({ where: { id, facility: facilityWhere(scope) }, select: { id: true } })) throw new Error("NOT_FOUND");
    const events = await db.auditEvent.findMany({ where: { organisationId: scope.organisationId, entityType: "Lead", entityId: id,
      action: { in: ["lead.created", "public_lead.created", "lead.updated", "lead.stage_changed"] } },
      include: { actor: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 50 });
    return Response.json({ data: events.map(e => ({ id: e.id, at: e.occurredAt, actor: e.actor?.name ?? "Website / system", action: e.action,
      beforeStage: (e.before as { stage?: string } | null)?.stage ?? null, afterStage: (e.after as { stage?: string } | null)?.stage ?? null })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

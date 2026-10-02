import { apiError } from "@/lib/api";
import { listLeasing } from "@/lib/leasing-service";
import { db } from "@/lib/db";
import { requireFacility, requirePermissionScope } from "@/lib/scope";
import { createLeadSchema } from "@/lib/validators";
import { sameOrigin } from "@/lib/request-security";

export async function GET() {
  try { const leads = (await listLeasing(await requirePermissionScope("leads.view"))).leads; return Response.json({ data: leads, meta: { count: leads.length } }); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { code: "ORIGIN_REJECTED", message: "The request origin is not allowed." } }, { status: 403 });
  const parsed = createLeadSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The lead payload is invalid.",
          fields: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 422 },
    );
  }

  try {
    const scope = await requirePermissionScope("leads.create", parsed.data.facilityId);
    await requireFacility(scope, parsed.data.facilityId);
    if (parsed.data.desiredUnitTypeId && !await db.unitType.findFirst({ where: { id: parsed.data.desiredUnitTypeId, facilityId: parsed.data.facilityId } })) throw new Error("FORBIDDEN");
    const data = await db.$transaction(async tx => {
      const customer = await tx.customer.create({ data: { organisationId: scope.organisationId, firstName: parsed.data.firstName, lastName: parsed.data.lastName, email: parsed.data.email, phone: parsed.data.phone } });
      const lead = await tx.lead.create({ data: { facilityId: parsed.data.facilityId, customerId: customer.id, desiredUnitTypeId: parsed.data.desiredUnitTypeId, source: parsed.data.source, notes: parsed.data.notes, expectedMoveIn: parsed.data.expectedMoveIn, assignedToId: scope.userId } });
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: parsed.data.facilityId, actorId: scope.userId, action: "customer.created", entityType: "Customer", entityId: customer.id } });
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: parsed.data.facilityId, actorId: scope.userId, action: "lead.created", entityType: "Lead", entityId: lead.id, after: { stage: lead.stage, source: lead.source, assignedToId: scope.userId } } });
      return lead;
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) { return apiError(error); }
}

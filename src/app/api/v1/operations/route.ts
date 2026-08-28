import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { createTaskSchema, dailyCloseSchema, maintenanceSchema, productSchema, stockMovementSchema, unitNoteSchema } from "@/lib/validators";

export async function GET() {
  try {
    const { organisationId, allowedFacilityIds } = await requirePermission("operations.view");
    const facilityScope = allowedFacilityIds ? { in: allowedFacilityIds } : undefined;
    const [tasks, notes, maintenance, products, dailyCloses, facilities] = await Promise.all([
      db.task.findMany({ where: { organisationId, ...(facilityScope ? { facilityId: facilityScope } : {}) }, include: { facility: true, assignee: true }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 100 }),
      db.unitNote.findMany({ where: { organisationId, ...(facilityScope ? { facilityId: facilityScope } : {}) }, include: { unit: true, author: true }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.maintenanceRequest.findMany({ where: { organisationId, ...(facilityScope ? { facilityId: facilityScope } : {}) }, include: { facility: true, unit: true, assignedTo: true }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 100 }),
      db.product.findMany({ where: { organisationId, active: true, ...(facilityScope ? { facilityId: facilityScope } : {}) }, include: { facility: true }, orderBy: { name: "asc" } }),
      db.dailyClose.findMany({ where: { organisationId, ...(facilityScope ? { facilityId: facilityScope } : {}) }, include: { facility: true, closedBy: true }, orderBy: { businessDate: "desc" }, take: 30 }),
      db.facility.findMany({ where: { organisationId, active: true, ...(facilityScope ? { id: facilityScope } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return Response.json({ data: { tasks, notes, maintenance, products, dailyCloses, facilities } });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { kind?: string; payload?: unknown };
    const permission = body.kind === "stockMovement" || body.kind === "product" ? "inventory.manage" : body.kind === "dailyClose" ? "daily_close.perform" : "operations.manage";
    const { organisationId, user, allowedFacilityIds } = await requirePermission(permission);
    const ensureFacility = async (facilityId: string) => {
      await requirePermission(permission, facilityId);
      if (!await db.facility.count({ where: { id: facilityId, organisationId, active: true } })) throw new Error("FORBIDDEN");
    };
    let result: unknown;
    const entityType = body.kind ?? "unknown";

    if (body.kind === "task") {
      const input = createTaskSchema.parse(body.payload);
      if (!input.facilityId && allowedFacilityIds) {
        return Response.json({ error: { code: "FACILITY_REQUIRED", message: "Choose a permitted facility for this task." } }, { status: 400 });
      }
      if (input.facilityId) await ensureFacility(input.facilityId);
      result = await db.task.create({ data: { organisationId, createdById: user.id, ...input, dueAt: input.dueAt ? new Date(input.dueAt) : undefined } });
    } else if (body.kind === "unitNote") {
      const input = unitNoteSchema.parse(body.payload);
      await ensureFacility(input.facilityId);
      const unit = await db.unit.findFirst({ where: { id: input.unitId, facilityId: input.facilityId, facility: { organisationId } } });
      if (!unit) throw new Error("FORBIDDEN");
      result = await db.unitNote.create({ data: { organisationId, authorId: user.id, ...input } });
    } else if (body.kind === "maintenance") {
      const input = maintenanceSchema.parse(body.payload);
      await ensureFacility(input.facilityId);
      if (input.unitId && !await db.unit.count({ where: { id: input.unitId, facilityId: input.facilityId } })) throw new Error("FORBIDDEN");
      result = await db.maintenanceRequest.create({ data: { organisationId, ...input, dueAt: input.dueAt ? new Date(input.dueAt) : undefined } });
    } else if (body.kind === "product") {
      const input = productSchema.parse(body.payload);
      await ensureFacility(input.facilityId);
      result = await db.product.create({ data: { organisationId, ...input } });
    } else if (body.kind === "stockMovement") {
      const input = stockMovementSchema.parse(body.payload);
      result = await db.$transaction(async (tx) => {
        const product = await tx.product.findFirst({ where: { id: input.productId, organisationId } });
        if (!product) throw new Error("FORBIDDEN");
        const delta = ["SALE", "DAMAGE"].includes(input.type) ? -Math.abs(input.quantity) : input.quantity;
        if (product.quantityOnHand + delta < 0) throw new Error("INSUFFICIENT_STOCK");
        const movement = await tx.stockMovement.create({ data: { ...input, quantity: delta, createdById: user.id } });
        await tx.product.update({ where: { id: product.id }, data: { quantityOnHand: { increment: delta } } });
        return movement;
      });
    } else if (body.kind === "dailyClose") {
      const input = dailyCloseSchema.parse(body.payload);
      await ensureFacility(input.facilityId);
      const allComplete = input.checks.every((check) => check.complete);
      if (!allComplete) return Response.json({ error: { code: "CHECKS_INCOMPLETE", message: "Complete every operational check before closing." } }, { status: 409 });
      result = await db.dailyClose.upsert({
        where: { facilityId_businessDate: { facilityId: input.facilityId, businessDate: new Date(`${input.businessDate}T00:00:00.000Z`) } },
        update: { ...input, businessDate: undefined, status: "CLOSED", variance: input.countedCash - input.expectedCash, closedById: user.id, closedAt: new Date() },
        create: { organisationId, ...input, businessDate: new Date(`${input.businessDate}T00:00:00.000Z`), status: "CLOSED", variance: input.countedCash - input.expectedCash, closedById: user.id, closedAt: new Date() },
      });
    } else {
      return Response.json({ error: { code: "UNKNOWN_OPERATION", message: "The requested operation type is not supported." } }, { status: 400 });
    }

    const entityId = typeof result === "object" && result && "id" in result ? String(result.id) : "unknown";
    await db.auditEvent.create({ data: { organisationId, actorId: user.id, action: `${entityType}.create`, entityType, entityId, after: JSON.parse(JSON.stringify(result)) } });
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") return Response.json({ error: { code: error.message, message: "This movement would make stock negative." } }, { status: 409 });
    return authErrorResponse(error);
  }
}

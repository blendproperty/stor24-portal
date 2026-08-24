import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { chargeDefinitionSchema, configurationSchema, discountPlanSchema, integrationSchema } from "@/lib/validators";

export async function GET() {
  try {
    const { organisationId, allowedFacilityIds } = await requirePermission("configuration.view");
    const facilityScope = allowedFacilityIds ? { in: allowedFacilityIds } : undefined;
    const [profiles, integrations, charges, discounts, facilities, roles, users] = await Promise.all([
      db.configurationProfile.findMany({ where: { organisationId, ...(facilityScope ? { OR: [{ facilityId: null }, { facilityId: facilityScope }] } : {}) }, orderBy: [{ domain: "asc" }, { name: "asc" }] }),
      db.integrationConnection.findMany({ where: { organisationId, ...(facilityScope ? { OR: [{ facilityId: null }, { facilityId: facilityScope }] } : {}) }, orderBy: [{ category: "asc" }, { provider: "asc" }] }),
      db.chargeDefinition.findMany({ where: { organisationId }, orderBy: { name: "asc" } }),
      db.discountPlan.findMany({ where: { organisationId }, orderBy: { name: "asc" } }),
      db.facility.findMany({ where: { organisationId, ...(facilityScope ? { id: facilityScope } : {}) }, orderBy: { name: "asc" } }),
      db.role.findMany({ where: { organisationId }, orderBy: { name: "asc" } }),
      db.user.findMany({ where: { organisationId, ...(allowedFacilityIds ? { roleAssignments: { some: { facilityId: facilityScope } } } : {}) }, select: { id: true, name: true, email: true, active: true }, orderBy: { name: "asc" } }),
    ]);
    const safeIntegrations = integrations.map((integration) => ({ ...integration, config: {} }));
    return Response.json({ data: { profiles, integrations: safeIntegrations, charges, discounts, facilities, roles, users } });
  } catch (error) { return authErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { kind?: string; payload?: unknown };
    const { organisationId, user } = await requirePermission("configuration.manage");
    if (body.kind === "profile") {
      const input = configurationSchema.parse(body.payload);
      if (input.facilityId) await requirePermission("configuration.manage", input.facilityId);
      const existing = await db.configurationProfile.findFirst({ where: { organisationId, facilityId: input.facilityId ?? null, domain: input.domain, name: input.name } });
      const profile = existing
        ? await db.configurationProfile.update({ where: { id: existing.id }, data: { status: input.status, config: input.config } })
        : await db.configurationProfile.create({ data: { organisationId, ...input } });
      await db.auditEvent.create({ data: { organisationId, actorId: user.id, action: "configuration.upsert", entityType: "configurationProfile", entityId: profile.id, after: profile } });
      return Response.json({ data: profile });
    }
    if (body.kind === "integration") {
      const input = integrationSchema.parse(body.payload);
      if (input.category === "ACCESS_CONTROL" && input.provider === "HIKCENTRAL") return Response.json({ error: { code: "DEDICATED_CONFIGURATION_REQUIRED", message: "Configure Hikvision from the secure Hikvision integration page." } }, { status: 400 });
      if (input.facilityId) await requirePermission("configuration.manage", input.facilityId);
      const existing = await db.integrationConnection.findFirst({ where: { organisationId, facilityId: input.facilityId ?? null, category: input.category, provider: input.provider } });
      const connection = existing
        ? await db.integrationConnection.update({ where: { id: existing.id }, data: { status: input.status, config: input.config } })
        : await db.integrationConnection.create({ data: { organisationId, ...input } });
      await db.auditEvent.create({ data: { organisationId, actorId: user.id, action: "integration.configure", entityType: "integrationConnection", entityId: connection.id, after: connection } });
      return Response.json({ data: connection });
    }
    if (body.kind === "charge") {
      const input = chargeDefinitionSchema.parse(body.payload);
      const charge = await db.chargeDefinition.upsert({ where: { organisationId_code: { organisationId, code: input.code } }, update: input, create: { organisationId, ...input } });
      await db.auditEvent.create({ data: { organisationId, actorId: user.id, action: "charge.upsert", entityType: "chargeDefinition", entityId: charge.id, after: JSON.parse(JSON.stringify(charge)) } });
      return Response.json({ data: charge });
    }
    if (body.kind === "discount") {
      const input = discountPlanSchema.parse(body.payload);
      const dates = { startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null };
      const discount = await db.discountPlan.upsert({ where: { organisationId_code: { organisationId, code: input.code } }, update: { ...input, ...dates }, create: { organisationId, ...input, ...dates } });
      await db.auditEvent.create({ data: { organisationId, actorId: user.id, action: "discount.upsert", entityType: "discountPlan", entityId: discount.id, after: JSON.parse(JSON.stringify(discount)) } });
      return Response.json({ data: discount });
    }
    return Response.json({ error: { code: "UNKNOWN_CONFIGURATION", message: "Unsupported configuration type." } }, { status: 400 });
  } catch (error) { return authErrorResponse(error); }
}

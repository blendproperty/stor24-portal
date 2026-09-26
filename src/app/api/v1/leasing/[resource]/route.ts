import { requireOperationalUnit } from "@/lib/floor-availability-service";
import { apiError, jsonBody } from "@/lib/api";
import { db } from "@/lib/db";
import {
  createCustomer,
  createFacility,
  createLead,
  createReservation,
  createUnit,
  createUnitType,
  listLeasing,
  requireLeasingCustomer,
} from "@/lib/leasing-service";
import { facilityWhere, requireFacility, requirePermissionScope } from "@/lib/scope";
import {
  customerSchema,
  customerPatchSchema,
  facilitySchema,
  leadSchema,
  reservationSchema,
  unitSchema,
  unitTypeSchema,
} from "@/lib/validators";
import { requireOwner, requirePermission } from "@/lib/auth-guards";
import { leasingResourcePermissions } from "@/lib/leasing-resource-permissions";
import { sameOrigin } from "@/lib/request-security";

const schemas = {
  facilities: facilitySchema,
  "unit-types": unitTypeSchema,
  units: unitSchema,
  customers: customerSchema,
  leads: leadSchema,
  reservations: reservationSchema,
} as const;
type Resource = keyof typeof schemas;
const isResource = (value: string): value is Resource => value in schemas;

export async function GET(
  _: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource } = await context.params;
    if (!isResource(resource)) throw new Error("NOT_FOUND");
    const data = await listLeasing(await requirePermissionScope(leasingResourcePermissions[resource].read));
    const values =
      resource === "unit-types"
        ? data.facilities.flatMap((f) => f.unitTypes)
        : resource === "units"
          ? data.facilities.flatMap((f) => f.units)
          : data[resource];
    return Response.json({ data: values, meta: { count: values.length } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    if (!sameOrigin(request))
      return Response.json(
        { error: { message: "Request rejected." } },
        { status: 403 },
      );
    const { resource } = await context.params;
    if (!isResource(resource)) throw new Error("NOT_FOUND");
    const scope = await requirePermissionScope(leasingResourcePermissions[resource].create);
    const parsed = schemas[resource].safeParse(await jsonBody(request));
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    if (resource === "unit-types") {
      const unitTypeData = parsed.data as { facilityId: string; name: string };
      if (
        await db.unitType.findFirst({
          where: {
            facilityId: unitTypeData.facilityId,
            name: { equals: unitTypeData.name, mode: "insensitive" },
          },
        })
      ) {
        return Response.json(
          {
            error: {
              code: "UNIT_TYPE_NAME_EXISTS",
              message: `A unit type named “${unitTypeData.name}” already exists at this store.`,
            },
          },
          { status: 409 },
        );
      }
    }
    const creators = {
      facilities: createFacility,
      "unit-types": createUnitType,
      units: createUnit,
      customers: createCustomer,
      leads: createLead,
      reservations: createReservation,
    } as const;
    const data = await (
      creators[resource] as (s: typeof scope, d: never) => Promise<unknown>
    )(scope, parsed.data as never);
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    if (!sameOrigin(request))
      return Response.json(
        { error: { message: "Request rejected." } },
        { status: 403 },
      );
    const { resource } = await context.params;
    if (!isResource(resource)) throw new Error("NOT_FOUND");
    const scope = await requirePermissionScope(leasingResourcePermissions[resource].change);
    const body = (await jsonBody(request)) as { id?: string; data?: unknown };
    if (!body.id) throw new Error("NOT_FOUND");
    const rawData = body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? body.data as Record<string, unknown>
      : {};
    const parsed = (resource === "customers" ? customerPatchSchema : schemas[resource].partial()).safeParse(rawData);
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    const data = Object.fromEntries(
      Object.keys(rawData)
        .filter((key) => key in parsed.data)
        .map((key) => [key, parsed.data[key as keyof typeof parsed.data]]),
    ) as never;
    let entity: unknown;
    let auditBefore: { number: string } | undefined;
    let auditAfter:
      | { number: string; mapLabelSynchronized: boolean }
      | undefined;
    if (resource === "facilities") {
      if (!scope.unrestrictedFacilities) throw new Error("FORBIDDEN");
      const current = await db.facility.findFirst({
        where: { id: body.id, ...facilityWhere(scope) },
      });
      if (!current) throw new Error("NOT_FOUND");
      const facilityData = data as {
        publicSlug?: string | null;
        publicBookingEnabled?: boolean;
      };
      if (
        facilityData.publicBookingEnabled === true &&
        !(facilityData.publicSlug ?? current.publicSlug)
      ) {
        return Response.json(
          { error: { code: "PUBLIC_SLUG_REQUIRED", message: "Add a public store address before enabling website booking." } },
          { status: 422 },
        );
      }
      if (
        facilityData.publicSlug &&
        await db.facility.findFirst({
          where: { publicSlug: facilityData.publicSlug, id: { not: current.id } },
        })
      ) {
        return Response.json(
          { error: { code: "PUBLIC_SLUG_EXISTS", message: "That public store address is already in use." } },
          { status: 409 },
        );
      }
      const updated = await db.$transaction(async tx => {
        const saved = await tx.facility.update({ where: { id: current.id }, data });
        await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "facilities.updated", entityType: "facilities", entityId: current.id } });
        return saved;
      });
      return Response.json({ data: updated });
    } else if (resource === "customers") {
      const customerId = body.id;
      return await db.$transaction(async tx => {
        const current = await requireLeasingCustomer(scope, customerId, tx);
        const next = { ...current, ...(data as Record<string, unknown>) };
        if (!next.companyName && !(next.firstName && next.lastName)) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Provide a person or company name." } }, { status: 422 });
        const updated = await tx.customer.update({ where: { id: current.id }, data });
        await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "customers.updated", entityType: "customers", entityId: current.id } });
        return Response.json({ data: updated });
      });
    } else {
      const model =
        resource === "unit-types"
          ? db.unitType
          : resource === "units"
            ? db.unit
            : resource === "leads"
              ? db.lead
              : db.reservation;
      const current = (await (model as typeof db.unit).findFirst({
        where: { id: body.id },
        include: { facility: true },
      } as never)) as { id: string; facilityId: string; number?: string } | null;
      if (!current) throw new Error("NOT_FOUND");
      await requireFacility(scope, current.facilityId);
      const parent = parsed.data as { facilityId?: string };
      if (parent.facilityId && parent.facilityId !== current.facilityId) throw new Error("FORBIDDEN");
      const relation = parsed.data as { customerId?: string; desiredUnitTypeId?: string; assignedToId?: string };
      if (relation.customerId) await requireLeasingCustomer(scope, relation.customerId);
      if (relation.desiredUnitTypeId && !await db.unitType.findFirst({ where: { id: relation.desiredUnitTypeId, facilityId: current.facilityId } })) throw new Error("FORBIDDEN");
      if (relation.assignedToId && !await db.user.findFirst({ where: { id: relation.assignedToId, organisationId: scope.organisationId, active: true, roleAssignments: { some: { OR: [{ facilityId: current.facilityId }, { facilityId: null }] } } } })) throw new Error("FORBIDDEN");
      if (resource === "unit-types") {
        const unitTypeData = parsed.data as { name?: string };
        if (
          unitTypeData.name &&
          (await db.unitType.findFirst({
            where: {
              facilityId: current.facilityId,
              name: { equals: unitTypeData.name, mode: "insensitive" },
              id: { not: current.id },
            },
          }))
        ) {
          return Response.json(
            {
              error: {
                code: "UNIT_TYPE_NAME_EXISTS",
                message: `A unit type named “${unitTypeData.name}” already exists at this store.`,
              },
            },
            { status: 409 },
          );
        }
      }
      if (resource === "units") {
        const unitData = parsed.data as {
          unitTypeId?: string;
          status?: string;
          number?: string;
        };
        if (
          unitData.number &&
          unitData.number !== current.number &&
          (await db.unit.findFirst({
            where: {
              facilityId: current.facilityId,
              number: { equals: unitData.number, mode: "insensitive" },
              id: { not: current.id },
            },
          }))
        ) {
          return Response.json(
            {
              error: {
                code: "UNIT_NUMBER_EXISTS",
                message: `Unit number ${unitData.number} already exists at this store.`,
              },
            },
            { status: 409 },
          );
        }
        if (
          unitData.status &&
          ["HELD", "RESERVED", "OCCUPIED"].includes(unitData.status)
        )
          throw new Error("CONFLICT");
        if (
          unitData.unitTypeId &&
          !(await db.unitType.findFirst({
            where: { id: unitData.unitTypeId, facilityId: current.facilityId },
          }))
        )
          throw new Error("CONFLICT");
        const linked = await db.unit.findUnique({
          where: { id: current.id },
          include: {
            occupancies: { where: { status: "ACTIVE" } },
            reservations: { where: { status: "ACTIVE" } },
          },
        });
        if (
          unitData.status &&
          (linked?.occupancies.length || linked?.reservations.length)
        )
          throw new Error("CONFLICT");
      }
      if (
        resource === "units" &&
        (parsed.data as { number?: string }).number &&
        (parsed.data as { number?: string }).number !== current.number
      ) {
        const nextNumber = (parsed.data as { number: string }).number;
        auditBefore = { number: current.number ?? "" };
        auditAfter = { number: nextNumber, mapLabelSynchronized: true };
        entity = await db.$transaction(async (tx) => {
          const updated = await tx.unit.update({
            where: { id: current.id },
            data,
          });
          await tx.mapElement.updateMany({
            where: { unitId: current.id },
            data: { label: nextNumber },
          });
          return updated;
        });
      } else if (resource === "unit-types") {
        const updated = await db.$transaction(async tx => {
          const saved = await tx.unitType.update({ where: { id: current.id }, data });
          await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "unit-types.updated", entityType: "unit-types", entityId: current.id } });
          return saved;
        });
        return Response.json({ data: updated });
      } else if (resource === "leads") {
        const updated = await db.$transaction(async tx => {
          const saved = await tx.lead.update({ where: { id: current.id }, data });
          await tx.auditEvent.create({ data: { organisationId: scope.organisationId, actorId: scope.userId, action: "leads.updated", entityType: "leads", entityId: current.id } });
          return saved;
        });
        return Response.json({ data: updated });
      } else if (resource === "reservations") {
        await requirePermission("reservations.manage", current.facilityId);
        const patch = data as { facilityId?: string; unitId?: string };
        if (patch.facilityId && patch.facilityId !== current.facilityId) throw new Error("FORBIDDEN");
        entity = await db.$transaction(async tx => {
          const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: current.id } });
          await requireOperationalUnit(tx, current.facilityId, patch.unitId ?? reservation.unitId);
          return tx.reservation.update({ where: { id: current.id }, data });
        });
      } else {
        entity = await (model as typeof db.unit).update({
          where: { id: current.id },
          data,
        });
      }
    }
    await db.auditEvent.create({
      data: {
        organisationId: scope.organisationId,
        actorId: scope.userId,
        action: `${resource}.updated`,
        entityType: resource,
        entityId: body.id,
        before: auditBefore,
        after: auditAfter,
      },
    });
    return Response.json({ data: entity });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  try {
    if (!sameOrigin(request))
      return Response.json(
        { error: { message: "Request rejected." } },
        { status: 403 },
      );
    const { resource } = await context.params;
    if (!isResource(resource)) throw new Error("NOT_FOUND");
    const scope = await requirePermissionScope(leasingResourcePermissions[resource].change);
    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get("id");
    const force = requestUrl.searchParams.get("force") === "true";
    if (!id) throw new Error("NOT_FOUND");
    if (resource === "customers") {
      await requireLeasingCustomer(scope, id);
      const entity = await db.customer.findFirst({
        where: { id, organisationId: scope.organisationId },
        include: { tenancies: true, reservations: true },
      });
      if (!entity) throw new Error("NOT_FOUND");
      if (entity.tenancies.length || entity.reservations.length)
        throw new Error("CONFLICT");
      await db.customer.delete({ where: { id } });
    } else if (resource === "facilities") {
      if (!scope.unrestrictedFacilities) throw new Error("FORBIDDEN");
      const entity = await db.facility.findFirst({
        where: { id, ...facilityWhere(scope) },
      });
      if (!entity) throw new Error("NOT_FOUND");
      await db.facility.update({ where: { id }, data: { active: false } });
    } else {
      const model =
        resource === "unit-types"
          ? db.unitType
          : resource === "units"
            ? db.unit
            : resource === "leads"
              ? db.lead
              : db.reservation;
      const entity = (await (model as typeof db.unit).findFirst({
        where: { id },
      })) as { facilityId: string } | null;
      if (!entity) throw new Error("NOT_FOUND");
      await requireFacility(scope, entity.facilityId);
      if (resource === "units") {
        if (!force) {
          await db.unit.update({
            where: { id },
            data: { status: "UNAVAILABLE" },
          });
        } else {
          await requireOwner();
          const linked = await db.unit.findUnique({
            where: { id },
            select: {
              _count: { select: { reservations: true, occupancies: true } },
            },
          });
          const historyCount =
            (linked?._count.reservations ?? 0) +
            (linked?._count.occupancies ?? 0);
          if (historyCount)
            return Response.json(
              {
                error: {
                  code: "UNIT_HAS_HISTORY",
                  message:
                    "This unit has reservation or occupancy history and cannot be permanently deleted.",
                },
              },
              { status: 409 },
            );
          await db.$transaction([
            db.maintenanceRequest.updateMany({
              where: { unitId: id },
              data: { unitId: null },
            }),
            db.unit.delete({ where: { id } }),
          ]);
        }
      } else if (resource === "reservations") {
        await db.reservation.update({
          where: { id },
          data: { status: "CANCELLED" },
        });
      } else {
        if (resource === "unit-types") {
          const assigned = await db.unit.count({ where: { unitTypeId: id } });
          if (assigned && !force)
            return Response.json(
              {
                error: {
                  code: "UNIT_TYPE_IN_USE",
                  message: `This unit type is used by ${assigned} unit${assigned === 1 ? "" : "s"}. An organisation owner can delete the type and its unused units.`,
                  assigned,
                  canForceDelete: true,
                },
              },
              { status: 409 },
            );
          if (assigned && force) {
            await requireOwner();
            const protectedUnits = await db.unit.count({
              where: {
                unitTypeId: id,
                OR: [
                  { reservations: { some: {} } },
                  { occupancies: { some: {} } },
                ],
              },
            });
            if (protectedUnits)
              return Response.json(
                {
                  error: {
                    code: "UNIT_TYPE_HAS_HISTORY",
                    message: `${protectedUnits} assigned unit${protectedUnits === 1 ? " has" : "s have"} reservation or occupancy history and cannot be deleted. Reassign those units first.`,
                  },
                },
                { status: 409 },
              );
            await db.$transaction([
              db.lead.updateMany({
                where: { desiredUnitTypeId: id },
                data: { desiredUnitTypeId: null },
              }),
              db.maintenanceRequest.updateMany({
                where: { unit: { unitTypeId: id } },
                data: { unitId: null },
              }),
              db.unit.deleteMany({ where: { unitTypeId: id } }),
              db.unitType.delete({ where: { id } }),
            ]);
          } else await (model as typeof db.unit).delete({ where: { id } });
        } else await (model as typeof db.unit).delete({ where: { id } });
      }
    }
    await db.auditEvent.create({
      data: {
        organisationId: scope.organisationId,
        actorId: scope.userId,
        action: `${resource}.deleted`,
        entityType: resource,
        entityId: id,
      },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

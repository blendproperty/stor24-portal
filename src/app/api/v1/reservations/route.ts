import { unitIsOperational, floorMapSelection } from "@/lib/floor-availability";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import {
  cancelReservation,
  createReservation,
  expireReservation,
  extendReservation,
  leasingCustomerWhere,
} from "@/lib/leasing-service";
import { sameOrigin } from "@/lib/request-security";
import { requireScope, requirePermissionScope } from "@/lib/scope";
import {
  reservationLifecycleSchema,
  reservationSchema,
} from "@/lib/validators";

export async function GET() {
  try {
    const auth = await requirePermission("reservations.manage");
    const scope = { organisationId: auth.organisationId, userId: auth.user.id, facilityIds: auth.allowedFacilityIds ?? [], unrestrictedFacilities: auth.allowedFacilityIds === null };
    const created = scope.unrestrictedFacilities ? [] : await db.auditEvent.findMany({ where: { organisationId: scope.organisationId, actorId: scope.userId, entityType: "Customer", action: "customer.created" }, select: { entityId: true } });
    const facilityWhere = {
      organisationId: auth.organisationId,
      active: true,
      ...(auth.allowedFacilityIds
        ? { id: { in: auth.allowedFacilityIds } }
        : {}),
    };
    const [facilities, customers, reservations] = await Promise.all([
      db.facility.findMany({
        where: facilityWhere,
        include: {
          maps: { select: { id: true, name: true, width: true, height: true, elements: {select: {id: true, type: true, x: true, y: true, width: true, height: true, rotation: true, label: true, unitId: true}, orderBy: {sortOrder: "asc"}} }, orderBy: {name: "asc"} },
          units: {
            where: { status: "AVAILABLE" },
            include: { unitType: true, mapElements: floorMapSelection },
            orderBy: { number: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      db.customer.findMany({
        where: { organisationId: scope.organisationId, OR: [leasingCustomerWhere(scope, scope.facilityIds), { id: { in: created.map(item => item.entityId) }, leads: { none: {} }, reservations: { none: {} }, tenancies: { none: {} } }] },
        select: { id: true, type: true, firstName: true, lastName: true, companyName: true, email: true, phone: true },
        orderBy: { updatedAt: "desc" },
      }),
      db.reservation.findMany({
        where: { facility: facilityWhere },
        include: {
          facility: true,
          customer: true,
          unit: { include: { unitType: true } },
          lead: true,
          convertedTenancy: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return Response.json({ data: { facilities: facilities.map(facility => ({ ...facility, units: facility.units.filter(unit => unitIsOperational(unit, facility.closedFloors)) })), customers, reservations } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return Response.json(
        { error: { message: "Request rejected." } },
        { status: 403 },
      );
    const parsed = reservationSchema.safeParse(await jsonBody(request));
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
    const scope = await requirePermissionScope("reservations.manage", parsed.data.facilityId);
    const data = await createReservation(scope, parsed.data);
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request))
      return Response.json(
        { error: { message: "Request rejected." } },
        { status: 403 },
      );
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("NOT_FOUND");
    const reservation = await db.reservation.findUnique({ where: { id } });
    if (!reservation) throw new Error("NOT_FOUND");
    await requirePermission("reservations.manage", reservation.facilityId);
    const data = await cancelReservation(await requireScope(), id);
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request))
      return Response.json(
        { error: { message: "Request rejected." } },
        { status: 403 },
      );
    const parsed = reservationLifecycleSchema.safeParse(
      await jsonBody(request),
    );
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
    const reservation = await db.reservation.findUnique({
      where: { id: parsed.data.reservationId },
    });
    if (!reservation) throw new Error("NOT_FOUND");
    await requirePermission("reservations.manage", reservation.facilityId);
    const scope = await requireScope();
    const data =
      parsed.data.action === "EXTEND"
        ? await extendReservation(
            scope,
            parsed.data.reservationId,
            parsed.data.holdExpiresAt,
            parsed.data.reason,
          )
        : await expireReservation(
            scope,
            parsed.data.reservationId,
            parsed.data.reason,
          );
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

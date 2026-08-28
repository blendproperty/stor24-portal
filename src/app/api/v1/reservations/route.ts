import { apiError, jsonBody } from "@/lib/api";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import {
  cancelReservation,
  createReservation,
  expireReservation,
  extendReservation,
} from "@/lib/leasing-service";
import { sameOrigin } from "@/lib/request-security";
import { requireScope } from "@/lib/scope";
import {
  reservationLifecycleSchema,
  reservationSchema,
} from "@/lib/validators";

export async function GET() {
  try {
    const auth = await requirePermission("reservations.manage");
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
          units: {
            where: { status: "AVAILABLE" },
            include: { unitType: true },
            orderBy: { number: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      db.customer.findMany({
        where: { organisationId: auth.organisationId },
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
    return Response.json({ data: { facilities, customers, reservations } });
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
    await requirePermission("reservations.manage", parsed.data.facilityId);
    const data = await createReservation(await requireScope(), parsed.data);
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

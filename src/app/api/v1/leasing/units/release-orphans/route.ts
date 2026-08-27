import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/request-security";

const inputSchema = z.object({
  facilityId: z.string().min(1),
  unitId: z.string().min(1).optional(),
});

const blockingOccupancyStatuses = ["PENDING", "ACTIVE", "NOTICE_GIVEN"] as const;

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return Response.json({ error: { message: "Request rejected." } }, { status: 403 });

    const parsed = inputSchema.safeParse(await jsonBody(request));
    if (!parsed.success)
      return Response.json(
        { error: { code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors } },
        { status: 422 },
      );

    const auth = await requirePermission("inventory.manage", parsed.data.facilityId);
    const facility = await db.facility.findFirst({
      where: { id: parsed.data.facilityId, organisationId: auth.organisationId },
      select: { id: true, name: true },
    });
    if (!facility) throw new Error("NOT_FOUND");

    const result = await db.$transaction(async (tx) => {
      const candidates = await tx.unit.findMany({
        where: {
          facilityId: facility.id,
          status: "RESERVED",
          ...(parsed.data.unitId ? { id: parsed.data.unitId } : {}),
        },
        select: {
          id: true,
          number: true,
          reservations: { where: { status: "ACTIVE" }, select: { id: true } },
          occupancies: {
            where: { status: { in: [...blockingOccupancyStatuses] } },
            select: {
              id: true,
              status: true,
              tenancy: {
                select: {
                  id: true,
                  status: true,
                  reservation: {
                    select: {
                      status: true,
                      publicPaymentSessions: { select: { provider: true } },
                    },
                  },
                  documents: { select: { id: true, type: true, signedAt: true } },
                  account: { select: { payments: { where: { status: "SUCCEEDED" }, select: { id: true } } } },
                },
              },
            },
          },
        },
        orderBy: { number: "asc" },
      });

      const released: string[] = [];
      const blocked: Array<{ unit: string; reasons: string[] }> = [];

      for (const unit of candidates) {
        const reasons: string[] = [];
        if (unit.reservations.length) reasons.push(`${unit.reservations.length} active reservation${unit.reservations.length === 1 ? "" : "s"}`);
        const cancellableTestOccupancies = unit.occupancies.filter((occupancy) => {
          const tenancy = occupancy.tenancy;
          const paymentSessions = tenancy.reservation?.publicPaymentSessions ?? [];
          return occupancy.status === "PENDING"
            && tenancy.status === "DRAFT"
            && tenancy.reservation?.status === "CANCELLED"
            && tenancy.account.payments.length === 0
            && tenancy.documents.every((document) => document.type === "LEASE_AGREEMENT_UAT" && !document.signedAt)
            && paymentSessions.every((session) => session.provider === "STOR24_SIMULATOR");
        });
        const protectedOccupancies = unit.occupancies.filter((occupancy) => !cancellableTestOccupancies.some((candidate) => candidate.id === occupancy.id));
        if (protectedOccupancies.length) reasons.push(`${protectedOccupancies.length} pending or active occupancy record${protectedOccupancies.length === 1 ? "" : "s"}`);
        if (reasons.length) {
          blocked.push({ unit: unit.number, reasons });
          continue;
        }

        for (const occupancy of cancellableTestOccupancies) {
          await tx.occupancy.update({ where: { id: occupancy.id }, data: { status: "CANCELLED", endDate: new Date(), accessState: "REVOKED" } });
          await tx.tenancy.update({ where: { id: occupancy.tenancy.id }, data: { status: "CANCELLED", endDate: new Date() } });
          await tx.document.updateMany({ where: { tenancyId: occupancy.tenancy.id, signedAt: null }, data: { status: "CANCELLED", signingToken: null } });
          await tx.auditEvent.create({
            data: {
              organisationId: auth.organisationId,
              facilityId: facility.id,
              actorId: auth.user.id,
              action: "tenancy.cancelled_test_artifact_cleanup",
              entityType: "Tenancy",
              entityId: occupancy.tenancy.id,
              before: { status: "DRAFT", occupancyStatus: "PENDING" },
              after: { status: "CANCELLED", occupancyStatus: "CANCELLED", simulated: true },
            },
          });
        }

        const changed = await tx.unit.updateMany({
          where: { id: unit.id, facilityId: facility.id, status: "RESERVED" },
          data: { status: "AVAILABLE" },
        });
        if (!changed.count) continue;
        released.push(unit.number);
        await tx.auditEvent.create({
          data: {
            organisationId: auth.organisationId,
            facilityId: facility.id,
            actorId: auth.user.id,
            action: "unit.orphaned_reservation_released",
            entityType: "Unit",
            entityId: unit.id,
            before: { status: "RESERVED" },
            after: { status: "AVAILABLE", reason: "No active reservation or occupancy" },
          },
        });
      }

      return { checked: candidates.length, released, blocked };
    });

    return Response.json({ data: { facilityId: facility.id, facilityName: facility.name, ...result } });
  } catch (error) {
    return apiError(error);
  }
}

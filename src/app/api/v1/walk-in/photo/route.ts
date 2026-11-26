import { db } from "@/lib/db";
import { facialPhotoError } from "@/lib/facial-photo-response";
import { issueHikCentralFaceHandoff } from "@/lib/hikcentral-face-capture";
import { rateLimit, sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";
import { tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { walkInPhotoToken, walkInUsable } from "@/lib/walk-in-policy";
import { eligibleWalkInReservation, walkInPhotoReservation } from "@/lib/walk-in-photo";
import { z } from "zod";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request) || Number(request.headers.get("content-length") ?? 0) > 1024) throw Error("FORBIDDEN");
    const body = await request.text();
    if (body.length > 1024) throw Error("PHOTO_INVALID");
    const input = z.object({ visitId: z.string().min(1).max(64), facilityId: z.string().min(1).max(64), identityChecked: z.literal(true) }).strict().safeParse(JSON.parse(body));
    if (!input.success) throw Error("PHOTO_IDENTITY_REQUIRED");
    const { visitId, facilityId } = input.data;
    await requirePermissionScope("reservations.manage", facilityId);
    const scope = await requirePermissionScope("move_in.create", facilityId);
    if (await rateLimit(`walk-in-photo-prepare:${scope.organisationId}:${scope.userId}`, 10, 60_000)) throw Error("PHOTO_RATE_LIMITED");
    const visit = await db.walkInVisit.findFirst({
      where: { id: visitId, organisationId: scope.organisationId, facilityId },
      include: { createdBy: { select: { active: true } }, facility: { select: { active: true, publicBookingEnabled: true } }, reservation: { select: walkInPhotoReservation } },
    });
    if (!visit?.customerTokenHash || !walkInUsable(visit) || !visit.reservation || !eligibleWalkInReservation(visit.reservation)) throw Error("PHOTO_CHANGED");
    const photo = visit.reservation.customer.hikCentralFaceCapture;
    if (photo && !["EXPIRED", "REJECTED", "WITHDRAWN", "PROVIDER_REMOVED"].includes(photo.status)) throw Error("PHOTO_CHANGED");
    await issueHikCentralFaceHandoff(scope, { customerId: visit.reservation.customerId, facilityId, version: photo?.version ?? 0 }, {
      token: walkInPhotoToken(visit.customerTokenHash),
      expiresAt: new Date(Math.min(visit.expiresAt.getTime(), Date.now() + 20 * 60_000)),
    });
    return Response.json({ data: { prepared: true } }, { headers: tenantPrivateHeaders });
  } catch (error) { return facialPhotoError(error); }
}

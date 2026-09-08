import { randomUUID } from "node:crypto";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission("operations.view");
    const { id } = await context.params;
    const lease = await db.publicReservationLease.findFirst({ where: { id, status: "SIGNED", signedPdf: { not: null }, reservation: { customer: { organisationId: auth.organisationId }, ...(auth.allowedFacilityIds ? { facilityId: { in: auth.allowedFacilityIds } } : {}) } }, include: { reservation: true } });
    if (!lease?.signedPdf) return Response.json({ error: { message: "Signed agreement not found." } }, { status: 404 });
    const requestId = `LEASE-${randomUUID().slice(0, 8).toUpperCase()}`;
    await db.auditEvent.create({ data: { organisationId: auth.organisationId, facilityId: lease.reservation.facilityId, actorId: auth.user.id, action: "public_lease.signed_pdf_downloaded", entityType: "PublicReservationLease", entityId: lease.id, requestId } });
    return new Response(lease.signedPdf, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="stor24-${lease.reservation.publicReference}-signed-agreement.pdf"`, "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff", "x-request-id": requestId, "x-document-sha256": lease.signedPdfSha256 ?? "" } });
  } catch (error) { return authErrorResponse(error); }
}

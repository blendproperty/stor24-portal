import { createHash } from "node:crypto";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission("operations.view");
    const { id } = await context.params;
    const lease = await db.publicReservationLease.findFirst({ where: { id, reservation: { customer: { organisationId: auth.organisationId }, ...(auth.allowedFacilityIds ? { facilityId: { in: auth.allowedFacilityIds } } : {}) } }, include: { mandate: true, reservation: true } });
    const m = lease?.mandate;
    if (!lease || !m?.signedPdf || !m.signedPdfSha256 || createHash("sha256").update(m.signedPdf).digest("hex") !== m.signedPdfSha256) return new Response(null, { status: 404 });
    await db.auditEvent.create({ data: { organisationId: auth.organisationId, facilityId: lease.reservation.facilityId, actorId: auth.user.id, action: "public_mandate.pdf_downloaded", entityType: "PublicDebitMandate", entityId: m.id } });
    return new Response(new Uint8Array(m.signedPdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="STOR24-mandate-${m.reference}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) { return authErrorResponse(e); }
}

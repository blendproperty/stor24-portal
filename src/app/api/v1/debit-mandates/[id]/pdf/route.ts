import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requirePermissionScope, facilityWhere } from "@/lib/scope";
import { guardDlpTransfer } from "@/lib/dlp-transfer-service";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requirePermissionScope("operations.view");
    const mandate = await db.publicDebitMandate.findFirst({ where: { id: (await params).id, status: "SIGNED", OR: [{ lease: { reservation: { facility: facilityWhere(scope) } } }, { session: { tenancy: { facility: facilityWhere(scope) } } }] }, include: { lease: { select: { reservation: { select: { facilityId: true } } } }, session: { select: { tenancy: { select: { facilityId: true } } } } } });
    if (!mandate?.signedPdf || !mandate.signedPdfSha256 || createHash("sha256").update(mandate.signedPdf).digest("hex") !== mandate.signedPdfSha256) throw new Error("NOT_FOUND");
    const facilityId = mandate.lease?.reservation.facilityId ?? mandate.session?.tenancy.facilityId;
    const headers = await guardDlpTransfer({ organisationId: scope.organisationId, actorId: scope.userId, facilityId, resourceId: mandate.id, channel: "DOWNLOAD", classification: "restricted", byteLength: mandate.signedPdf.byteLength });
    return new Response(new Uint8Array(mandate.signedPdf), { headers: { ...headers, "content-type": "application/pdf", "content-disposition": `attachment; filename="STOR24-mandate-${mandate.reference}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return apiError(error); }
}

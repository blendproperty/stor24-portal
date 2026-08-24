import { fetchBlendSignArtifact, type BlendSignArtifact } from "@/lib/blendsign-client";
import { db } from "@/lib/db";
import { authErrorResponse, requirePermission } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

function isArtifact(value: string): value is BlendSignArtifact {
  return value === "signed" || value === "certificate";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; artifact: string }> }) {
  try {
    const { id, artifact } = await context.params;
    if (!isArtifact(artifact)) return Response.json({ error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });
    const auth = await requirePermission("operations.view");
    const document = await db.document.findFirst({
      where: {
        id,
        provider: "BLENDSIGN",
        status: "SIGNED",
        externalId: { not: null },
        tenancy: {
          facility: { organisationId: auth.organisationId },
          ...(auth.allowedFacilityIds ? { facilityId: { in: auth.allowedFacilityIds } } : {}),
        },
      },
      include: { tenancy: true },
    });
    if (!document?.externalId) return Response.json({ error: { code: "NOT_FOUND", message: "Completed document not found." } }, { status: 404 });
    const upstream = await fetchBlendSignArtifact(document.externalId, artifact);
    if (!upstream.ok) {
      const status = upstream.status === 409 ? 409 : upstream.status === 404 ? 404 : 502;
      return Response.json({ error: { code: "BLENDSIGN_DOCUMENT_UNAVAILABLE", message: status === 409 ? "The completed document is still being prepared." : "The completed document is currently unavailable." } }, { status });
    }
    const body = await upstream.arrayBuffer();
    await db.auditEvent.create({ data: { organisationId: auth.organisationId, facilityId: document.tenancy.facilityId, actorId: auth.user.id, action: `document.${artifact}.downloaded`, entityType: "Document", entityId: document.id } });
    return new Response(body, { headers: {
      "content-type": "application/pdf",
      "content-disposition": upstream.headers.get("content-disposition") ?? `attachment; filename="stor24-${artifact}.pdf"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

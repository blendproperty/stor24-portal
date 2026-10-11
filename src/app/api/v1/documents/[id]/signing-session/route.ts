import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { facilityWhere, requirePermissionScope } from "@/lib/scope";
import { fetchBlendSignSigningSession } from "@/lib/blendsign-client";
import { retryBlendSignLease } from "@/lib/blendsign-lease-service";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const { id } = await params;
    const scope = await requirePermissionScope("move_in.create");
    await retryBlendSignLease(scope, id, "ASSISTED");
    return Response.json({ data: { prepared: true } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  try {
    const { id } = await params;
    const scope = await requirePermissionScope("move_in.create");
    const document = await db.document.findFirst({
      where: { id, type: "LEASE_AGREEMENT", provider: "BLENDSIGN", tenancy: { facility: facilityWhere(scope) } },
      include: { tenancy: { select: { accountId: true, status: true, paymentMethod: true, mandateSession: { select: { mandate: { select: { status: true, signedPdfSha256: true } } } }, reservation: { select: { id: true, leadId: true } } } } },
    });
    if (!document) throw new Error("NOT_FOUND");
    const context = { accountId: document.tenancy.accountId, reservationId: document.tenancy.reservation?.id ?? null, leadId: document.tenancy.reservation?.leadId ?? null, paymentMethod: document.tenancy.paymentMethod, mandate: document.tenancy.mandateSession?.mandate ?? null };
    if (document.status === "SIGNED" && document.signedAt) return Response.json({ data: { ...context, completed: true, signers: [] } }, { headers });
    if (["CANCELLED", "VOIDED", "DECLINED", "EXPIRED"].includes(document.status) || document.tenancy.status !== "DRAFT") {
      return Response.json({ error: { message: "This lease is not available for signing. Review its account." } }, { status: 409, headers });
    }
    if (!document.externalId) return Response.json({ data: { ...context, completed: false, dispatchRequired: true, signers: [] } }, { headers });
    const session = await fetchBlendSignSigningSession(document.externalId);
    return Response.json({ data: { ...context, completed: false, reconciling: session.status === "COMPLETED", signers: session.signers } }, { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
}

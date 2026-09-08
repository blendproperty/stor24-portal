import { db } from "@/lib/db";
import { publicApiAuthorized } from "@/lib/public-booking-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const { token } = await context.params;
  const lease = await db.publicReservationLease.findFirst({ where: { signingToken: token, status: "SIGNED", signedPdf: { not: null } }, include: { reservation: true } });
  if (!lease?.signedPdf) return Response.json({ error: { message: "Signed agreement not found." } }, { status: 404 });
  return new Response(lease.signedPdf, { headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="stor24-${lease.reservation.publicReference}-signed-agreement.pdf"`,
    "cache-control": "private, no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "x-document-sha256": lease.signedPdfSha256 ?? "",
  } });
}

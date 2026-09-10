import { STORAGE_TERMS_VERSION, storageTermsText } from "@/lib/storage-terms";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { renderSignedLeasePdf } from "@/lib/public-lease-pdf";

export async function GET(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const bytes = await renderSignedLeasePdf({ unsigned: true, content: storageTermsText(), reference: STORAGE_TERMS_VERSION, paymentMethod: "", signerName: "", signedAt: new Date("2026-09-10T00:00:00Z"), sha256: "" });
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="stor24-storage-terms-review.pdf"', "cache-control": "no-store" } });
}

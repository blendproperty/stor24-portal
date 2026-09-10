import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { hostedMandatePdf } from "@/lib/public-hosted-mandate";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!publicApiAuthorized(request)) return new Response(null, { status: 401 });
  try {
    const { pdf, reference } = await hostedMandatePdf((await context.params).token);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="STOR24-mandate-${reference}.pdf"`, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
  } catch { return Response.json({ error: { message: "The signed mandate PDF is not ready. Check mandate confirmation again shortly." } }, { status: 409, headers: { "cache-control": "no-store" } }); }
}

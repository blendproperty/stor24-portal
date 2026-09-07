import { z } from "zod";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { getPublicNetcashSandboxPayment } from "@/lib/public-netcash-payment";

const schema = z.object({
  reference: z.string().trim().min(10).max(40),
  paymentId: z.string().trim().min(10).max(40),
});

export async function GET(request: Request) {
  if (!publicApiAuthorized(request)) {
    return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  }
  const url = new URL(request.url);
  const parsed = schema.safeParse({
    reference: url.searchParams.get("reference"),
    paymentId: url.searchParams.get("paymentId"),
  });
  if (!parsed.success) {
    return Response.json({ error: { message: "Invalid payment status request." } }, { status: 422 });
  }
  const result = await getPublicNetcashSandboxPayment(parsed.data.reference, parsed.data.paymentId);
  if (!result.ok) {
    return Response.json({ error: { code: result.code, message: "Payment status is unavailable." } }, { status: 404 });
  }
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}

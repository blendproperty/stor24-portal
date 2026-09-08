import { z } from "zod";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { cancelPublicNetcashSandboxPayment } from "@/lib/public-netcash-payment";

const schema = z.object({
  reference: z.string().trim().min(10).max(40),
  paymentId: z.string().trim().min(10).max(40),
});

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) {
    return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { message: "Invalid cancellation request." } }, { status: 422 });
  }
  const result = await cancelPublicNetcashSandboxPayment(parsed.data.reference, parsed.data.paymentId);
  if (!result.ok) {
    return Response.json({ error: { code: result.code, message: "Payment is unavailable." } }, { status: 404 });
  }
  return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
}

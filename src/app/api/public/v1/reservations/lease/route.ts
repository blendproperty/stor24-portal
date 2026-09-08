import { z } from "zod";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { preparePublicReservationLease } from "@/lib/public-lease-workflow";

const schema = z.object({
  reference: z.string().trim().regex(/^ST24-\d{8}-[A-F0-9]{6}$/),
  paymentMethod: z.enum(["CARD", "EFT", "DEBIT_ORDER"]),
});

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Invalid reservation reference." } }, { status: 422 });
  const result = await preparePublicReservationLease(parsed.data.reference, parsed.data.paymentMethod);
  if (!result.ok) return Response.json({ error: { code: result.code, message: result.code === "MOVE_IN_DATE_REQUIRED" ? "Choose a move-in date before reviewing the lease." : "The lease cannot be prepared for this reservation." } }, { status: 409 });
  return Response.json({ data: result }, { status: result.status === "SIGNED" ? 200 : 201, headers: { "cache-control": "no-store" } });
}

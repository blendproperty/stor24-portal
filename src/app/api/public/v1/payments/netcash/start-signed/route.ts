import { z } from "zod";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { publicReservationHasSignedLease } from "@/lib/public-lease-workflow";
import { startPublicNetcashSandboxPayment } from "@/lib/public-netcash-payment";

const schema = z.object({ reference: z.string().trim().min(10).max(40), idempotencyKey: z.string().uuid() });

export async function POST(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: "Invalid payment request." } }, { status: 422 });
  const lease = await publicReservationHasSignedLease(parsed.data.reference);
  if (!lease) return Response.json({ error: { code: "LEASE_SIGNATURE_REQUIRED", message: "Sign the lease before starting payment." } }, { status: 409 });
  try {
    const result = await startPublicNetcashSandboxPayment(parsed.data.reference, parsed.data.idempotencyKey);
    if (!result.ok) return Response.json({ error: { code: result.code, message: "This reservation is not available for payment." } }, { status: 409 });
    return Response.json({ data: { ...result, lease: { id: lease.id, version: lease.version, sha256: lease.sha256, signedAt: lease.signedAt?.toISOString() ?? null } } }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":")[0] : "NETCASH_CHECKOUT_FAILED";
    const unavailable = code === "NETCASH_TRANSACTION_PROCESSING_DISABLED" || code === "NETCASH_NOT_CONFIGURED";
    return Response.json({ error: { code, message: unavailable ? "Netcash test payments are not enabled." : "The Netcash checkout could not be started." } }, { status: unavailable ? 503 : 409 });
  }
}

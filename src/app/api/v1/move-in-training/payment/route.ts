import { requireSession, authErrorResponse } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { bookingTestPaymentSnapshot, recordBookingTestPayment } from "@/lib/booking-test-payment";
const headers = { "Cache-Control": "no-store, private" };
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    TRAINING_DISABLED: "The owner has switched training off. No test payment was recorded.",
    TRAINING_CHANGED: "Training was restarted. Refresh before recording a test payment.",
    TEST_PAYMENT_EXISTS: "A test payment is already saved for this booking. Refresh to review it.",
  };
  return messages[code] ? Response.json({ error: { message: messages[code] } }, { status: 409, headers }) : authErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    const auth = await requireSession();
    return Response.json({ data: await bookingTestPaymentSnapshot(auth.user.id, new URL(request.url).searchParams.get("reservation") ?? "") }, { headers });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const auth = await requireSession();
    return Response.json({ data: await recordBookingTestPayment(auth.user.id, await request.json()) }, { headers });
  } catch (e) { return failure(e); }
}

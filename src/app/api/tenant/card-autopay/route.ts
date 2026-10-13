import { z } from "zod";
import { requireTenantSession, tenantRateLimit } from "@/lib/tenant-portal-auth";
import { sameOrigin } from "@/lib/request-security";
import { tenantError, tenantPrivateHeaders } from "@/lib/tenant-portal-response";
import { cardAutopayScheduleSchema } from "@/lib/payments/card-autopay-policy";
import { previewCardAutopayRequest, saveCardAutopayRequest, withdrawCardAutopayRequest } from "@/lib/payments/card-autopay-service";
const accountId = z.string().min(1).max(100);
const inputSchema = z.union([
  z.object({ accountId, schedule: cardAutopayScheduleSchema, action: z.enum(["preview", "request"]), fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), accepted: z.literal(true).optional() }).strict(),
  z.object({ accountId, action: z.literal("withdraw"), requestId: z.string().min(1).max(100) }).strict(),
]);
export async function POST(request: Request) {
  try {
    // Preparation is opt-in and separate from card processing. This endpoint can never activate a subscription.
    if (process.env.CARD_AUTOPAY_PREPARATION_ENABLED !== "true") return Response.json({ error: "Monthly card payment setup is not available yet." }, { status: 404, headers: tenantPrivateHeaders });
    if (!sameOrigin(request)) throw new Error("TENANT_NOT_FOUND");
    const session = await requireTenantSession();
    if (await tenantRateLimit(`tenant:card-autopay:${session.tokenHash}`, 10, 60000)) return Response.json({ error: "Please wait before trying again." }, { status: 429, headers: tenantPrivateHeaders });
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the requested schedule and amount review." }, { status: 422, headers: tenantPrivateHeaders });
    const input = parsed.data;
    if (input.action === "withdraw") return Response.json({ data: await withdrawCardAutopayRequest(session, input.accountId, input.requestId) }, { headers: tenantPrivateHeaders });
    if (input.action === "request" && (!input.fingerprint || input.accepted !== true)) return Response.json({ error: "Review and accept the monthly payment request first." }, { status: 422, headers: tenantPrivateHeaders });
    const data = input.action === "preview" ? await previewCardAutopayRequest(session, input.accountId, input.schedule) : await saveCardAutopayRequest(session, input.accountId, input.schedule, input.fingerprint!, input.accepted!);
    return Response.json({ data }, { headers: tenantPrivateHeaders });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CARD_AUTOPAY_")) return Response.json({ error: "This account or schedule needs review before monthly card setup can proceed." }, { status: 409, headers: tenantPrivateHeaders });
    return tenantError(error);
  }
}


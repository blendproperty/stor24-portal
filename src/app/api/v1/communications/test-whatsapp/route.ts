import { authErrorResponse, requireOwner } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { TwilioWhatsAppProvider } from "@/lib/integrations/twilio-provider";
import { privacyHash, rateLimit, sameOrigin } from "@/lib/request-security";

const SOUTH_AFRICAN_E164 = /^\+27[1-9]\d{8}$/;

export async function POST(request: Request) {
  try {
    const auth = await requireOwner();
    if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
    if (await rateLimit(`test-whatsapp:${auth.user.id}`, 3, 15 * 60 * 1000)) return Response.json({ error: "Test limit reached. Try again in 15 minutes." }, { status: 429 });
    const body = await request.json().catch(() => ({}));
    const recipient = typeof body.recipient === "string" ? body.recipient.replace(/[\s()-]/g, "") : "";
    if (!SOUTH_AFRICAN_E164.test(recipient)) return Response.json({ error: "Enter a South African WhatsApp number in +27 international format." }, { status: 422 });
    const contentSid = process.env.TWILIO_WHATSAPP_TEST_CONTENT_SID ?? "";
    const result = await new TwilioWhatsAppProvider().sendTemplate(recipient, contentSid, {
      "1": "Stor24 test recipient",
      "2": "TEST",
      "3": "Stor24 connection test",
      "4": new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(new Date()),
      "5": "R0.00 test only",
    }, { organisationId: auth.user.organisationId, idempotencyKey: `test-whatsapp:${auth.user.id}:${Date.now()}` });
    await db.auditEvent.create({ data: { organisationId: auth.user.organisationId, actorId: auth.user.id, action: result.ok ? "communication.whatsapp.test_succeeded" : "communication.whatsapp.test_failed", entityType: "Integration", entityId: "TWILIO_WHATSAPP", after: { recipientHash: privacyHash(recipient), provider: "twilio", resultCode: result.ok ? "QUEUED" : result.code } } });
    if (!result.ok) return Response.json({ error: result.message, code: result.code }, { status: 502 });
    return Response.json({ data: { queued: true } });
  } catch (error) { return authErrorResponse(error); }
}

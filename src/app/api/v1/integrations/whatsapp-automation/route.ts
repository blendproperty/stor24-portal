import { z } from "zod";
import { authErrorResponse, requireOwner } from "@/lib/auth-guards";
import { setWhatsAppAutomationState, whatsAppServerGateEnabled } from "@/lib/integrations/whatsapp-automation";

const schema = z.object({ enabled: z.boolean() });

export async function PATCH(request: Request) {
  try {
    const session = await requireOwner();
    const input = schema.parse(await request.json());
    if (input.enabled && !whatsAppServerGateEnabled()) return Response.json({ error: { message: "The production WhatsApp safety gate is disabled. Run the approved server configuration before enabling automation." } }, { status: 409 });
    if (input.enabled && !(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && process.env.TWILIO_WHATSAPP_RESERVATION_CONFIRMED_SID)) return Response.json({ error: { message: "The WhatsApp sender and reservation template must be configured before enabling automation." } }, { status: 409 });
    const data = await setWhatsAppAutomationState({ organisationId: session.user.organisationId, actorId: session.user.id, enabled: input.enabled });
    return Response.json({ data });
  } catch (error) {
    return authErrorResponse(error);
  }
}

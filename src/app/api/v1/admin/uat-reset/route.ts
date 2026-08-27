import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { getUatResetPreview, resetUatCustomerData } from "@/lib/uat-reset-service";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("reset"), confirmation: z.literal("RESET TEST CUSTOMERS") }),
]);

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const auth = await requireOwner();
    const parsed = inputSchema.safeParse(await jsonBody(request));
    if (!parsed.success)
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "The reset confirmation is invalid." } }, { status: 422 });
    const organisationId = auth.user.organisationId;
    const data = parsed.data.action === "preview"
      ? await getUatResetPreview(organisationId)
      : await resetUatCustomerData({ organisationId, actorId: auth.user.id });
    return Response.json({ data: { action: parsed.data.action, ...data } });
  } catch (error) {
    return apiError(error);
  }
}

import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { getTestCustomerCleanupPreview, resetUatCustomerData } from "@/lib/uat-reset-service";

const ids = z.array(z.string().min(1).max(100)).min(1).max(100).refine(items => new Set(items).size === items.length);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ids }).strict(),
  z.object({ action: z.literal("delete"), ids, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal("DELETE SELECTED TEST CUSTOMERS") }).strict(),
]);

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const auth = await requireOwner();
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) return Response.json({ error: { message: "Select 1–100 distinct customers and provide the required confirmation." } }, { status: 422 });
    const input = parsed.data;
    const organisationId = auth.user.organisationId;
    const data = input.action === "preview"
      ? await getTestCustomerCleanupPreview(organisationId, input.ids)
      : await resetUatCustomerData({ organisationId, actorId: auth.user.id, selection: { ids: input.ids, fingerprint: input.fingerprint } });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "TEST_CUSTOMER_REVIEW_REQUIRED") return Response.json({ error: { message: "Nothing deleted. Selection includes payment, agreement, mandate, access, insurance, integration, queued communication or shared training records. Review these records before cleanup." } }, { status: 409 });
    return apiError(error);
  }
}

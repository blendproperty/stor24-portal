import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { requireOwner } from "@/lib/auth-guards";
import { sameOrigin } from "@/lib/request-security";
import { getTestCustomerCleanupPreview, resetUatCustomerData } from "@/lib/uat-reset-service";
import { setReservationCustomerArchive } from "@/lib/reservation-customer-archive";

const ids = z.array(z.string().min(1).max(100)).min(1).max(100).refine(items => new Set(items).size === items.length);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), ids }).strict(),
  z.object({ action: z.literal("delete"), ids, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.literal("DELETE SELECTED TEST CUSTOMERS") }).strict(),
  z.object({ action: z.enum(["archive", "restore"]), ids, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
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
      : input.action === "delete"
        ? await resetUatCustomerData({ organisationId, actorId: auth.user.id, selection: { ids: input.ids, fingerprint: input.fingerprint } })
        : await setReservationCustomerArchive({ organisationId, actorId: auth.user.id, ids: input.ids, fingerprint: input.fingerprint, archived: input.action === "archive" });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

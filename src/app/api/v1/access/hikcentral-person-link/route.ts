import { z } from "zod";

import { apiError } from "@/lib/api";
import { linkExistingHikCentralPerson, previewExistingHikCentralPerson } from "@/lib/hikcentral-person-link";
import { sameOrigin } from "@/lib/request-security";
import { requirePermissionScope } from "@/lib/scope";

export const runtime = "nodejs";

const inputSchema = z.object({
  action: z.enum(["preview", "link"]),
  facilityId: z.cuid(),
  customerId: z.cuid(),
  personCode: z.string().trim().regex(/^[A-Za-z0-9]{1,16}$/),
  expectedPersonId: z.string().min(1).max(100).optional(),
  identityChecked: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Select a customer and facility, then enter the HikCentral person ID." } }, { status: 422 });
    const input = parsed.data;
    const scope = await requirePermissionScope("access.manage", input.facilityId);
    await requirePermissionScope("integrations.manage", input.facilityId);
    if (input.action === "preview") return Response.json({ data: await previewExistingHikCentralPerson(scope, input.facilityId, input.customerId, input.personCode) }, { headers: { "Cache-Control": "private, no-store" } });
    if (!input.expectedPersonId || !input.identityChecked) return Response.json({ error: { code: "PHOTO_IDENTITY_REQUIRED", message: "Check the original ID and confirm the HikCentral person before linking." } }, { status: 422 });
    return Response.json({ data: await linkExistingHikCentralPerson(scope, { ...input, expectedPersonId: input.expectedPersonId, identityChecked: input.identityChecked }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("HIKCENTRAL_PERSON_")) return Response.json({ error: { code: error.message, message: error.message === "HIKCENTRAL_PERSON_LOOKUP_FAILED" ? "HikCentral could not confirm this person. Check the ID and connection." : "The HikCentral person does not match this customer or is already linked." } }, { status: error.message === "HIKCENTRAL_PERSON_LOOKUP_FAILED" ? 502 : 409 });
    if (error instanceof Error && ["HIKCENTRAL_CUSTOMER_ALREADY_LINKED", "HIKCENTRAL_LINK_REVIEW_REQUIRED", "PHOTO_IDENTITY_REQUIRED"].includes(error.message)) return Response.json({ error: { code: error.message, message: "Review the existing customer link and original ID before changing it." } }, { status: 409 });
    return apiError(error);
  }
}

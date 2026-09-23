import { z } from "zod";
import { revalidatePath } from "next/cache";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { setFloorOperational } from "@/lib/floor-availability-service";

const inputSchema = z.object({ facilityId: z.string().min(1), floor: z.string().trim().min(1).max(100), operational: z.boolean(), expectedOperational: z.boolean() }).strict();

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const parsed = inputSchema.safeParse(await jsonBody(request));
    if (!parsed.success) return Response.json({ error: { message: "Select a floor and its operating status." } }, { status: 422 });
    const scope = await requirePermissionScope("inventory.manage", parsed.data.facilityId);
    const data = await setFloorOperational(scope, parsed.data);
    revalidatePath("/", "layout");
    return Response.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "FLOOR_STATE_CHANGED") return Response.json({ error: { message: "This floor was changed by another staff member. Refresh before trying again." } }, { status: 409 });
    return apiError(error);
  }
}

import { z } from "zod";
import { combineUnits } from "@/lib/combine-units-service";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermission } from "@/lib/auth-guards";
import { requireScope, requireFacility } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
const schema = z.object({
  facilityId: z.string().min(1).max(64),
  unitIds: z.array(z.string().min(1).max(64)).min(1).max(2),
  action: z.enum(["preview", "apply"]),
  physicalConnectionConfirmed: z.boolean().default(false),
  expectedToken: z.string().optional(),
});
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const input = schema.parse(await jsonBody(request));
    const scope = await requireScope();
    await requirePermission("inventory.manage", input.facilityId);
    await requireFacility(scope, input.facilityId);
    const result = await combineUnits(scope, input);
    return Response.json({ data: result });
  } catch (error) {
    if (
      error instanceof Error &&
      /^(Select |Both |Units |The saved |Record |Confirm |The units )/.test(
        error.message,
      )
    )
      return Response.json(
        { error: { code: "COMBINATION_CONFLICT", message: error.message } },
        { status: 409 },
      );
    return apiError(error);
  }
}

import { z } from "zod";
import { apiError, jsonBody } from "@/lib/api";
import { bulkUnitPricingSchema } from "@/lib/bulk-unit-pricing";
import { bulkUnitPricing } from "@/lib/bulk-unit-pricing-service";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const input = bulkUnitPricingSchema.parse(await jsonBody(request));
    const scope = await requirePermissionScope("inventory.manage", input.facilityId);
    return Response.json({ data: await bulkUnitPricing(scope, input) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { message: "Select units and enter a valid adjustment." } }, { status: 422 });
    if (error instanceof Error && error.message === "RATE_OUT_OF_RANGE") return Response.json({ error: { message: "Every proposed rate must be above zero and no more than R10,000,000." } }, { status: 422 });
    if (error instanceof Error && error.message === "RATE_PREVIEW_STALE") return Response.json({ error: { message: "The selection or rates changed. Preview again before saving." } }, { status: 409 });
    return apiError(error);
  }
}

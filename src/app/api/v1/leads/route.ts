import { apiError, jsonBody } from "@/lib/api";
import { listLeasing } from "@/lib/leasing-service";
import { createManualLead } from "@/lib/manual-lead-service";
import { requirePermissionScope } from "@/lib/scope";
import { createLeadSchema } from "@/lib/validators";
import { sameOrigin } from "@/lib/request-security";

export async function GET() {
  try { const leads = (await listLeasing(await requirePermissionScope("leads.view"))).leads; return Response.json({ data: leads, meta: { count: leads.length } }); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: { code: "ORIGIN_REJECTED", message: "The request origin is not allowed." } }, { status: 403 });
  try {
  const parsed = createLeadSchema.safeParse(await jsonBody(request));

  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The lead payload is invalid.",
          fields: parsed.error.flatten().fieldErrors,
        },
      },
      { status: 422 },
    );
  }

    const scope = await requirePermissionScope("leads.create", parsed.data.facilityId);
    const data = await createManualLead(scope, parsed.data);
    return Response.json({ data }, { status: 201 });
  } catch (error) { return apiError(error); }
}

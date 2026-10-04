import { apiError, jsonBody } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import {
  marketingWorkspace,
  saveMarketing,
  updateMarketing,
} from "@/lib/marketing-service";
import { marketingInput, marketingUpdate } from "@/lib/marketing-contract";
export async function GET() {
  try {
    return Response.json(
      {
        data: await marketingWorkspace(
          await requirePermissionScope("leads.view"),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: { message: "Request origin rejected" } },
      { status: 403 },
    );
  try {
    const scope = await requirePermissionScope("leads.create");
    const parsed = marketingInput.safeParse(await jsonBody(request));
    if (!parsed.success)
      return Response.json(
        { error: { message: "Check the required fields, dates and amounts." } },
        { status: 422 },
      );
    return Response.json(
      { data: await saveMarketing(scope, parsed.data) },
      { status: 201 },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function PATCH(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: { message: "Request origin rejected" } },
      { status: 403 },
    );
  try {
    const scope = await requirePermissionScope("leads.create"),
      parsed = marketingUpdate.safeParse(await jsonBody(request));
    if (!parsed.success)
      return Response.json(
        { error: { message: "Check the required fields, dates and amounts." } },
        { status: 422 },
      );
    return Response.json({ data: await updateMarketing(scope, parsed.data) });
  } catch (e) {
    if (e instanceof Error && e.message === "CONFLICT")
      return Response.json(
        {
          error: {
            message:
              "This record changed. Close this form, refresh and reopen it before saving.",
          },
        },
        { status: 409 },
      );
    return apiError(e);
  }
}

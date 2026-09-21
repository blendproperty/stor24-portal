import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { mriConfiguration, mriSourceReview, saveMriConfiguration } from "@/lib/mri-service";

export const dynamic = "force-dynamic";
const messages: Record<string, string> = {
  MRI_ORG_PERMISSION: "MRI preparation requires organisation-wide finance permission.",
  MRI_CHANGED: "The settings changed. Reload before saving again.",
  MRI_ENCRYPTION: "Secure integration storage must be configured on the server first.",
  MRI_CREDENTIALS: "Enter the API login and password together.",
  MRI_MONTH: "Choose a valid current or past month.",
  MRI_SOURCE_LIMIT: "This month exceeds the 10,000-movement review limit. A larger-volume review is required before proceeding.",
  MRI_CONFIG_VERSION: "The saved MRI configuration needs a reviewed migration. It has not been overwritten.",
  MRI_DUPLICATE_CONFIG: "Multiple MRI configurations require administrator review.",
};
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const forbidden = ["FORBIDDEN", "MRI_ORG_PERMISSION"].includes(code);
  if (code === "UNAUTHENTICATED" || forbidden) return Response.json({ error: forbidden ? messages[code] ?? "Permission required." : "Sign in is required." }, { status: forbidden ? 403 : 401 });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the settings. Supply login and password together; choose a database label and environment." }, { status: 400 });
  if (messages[code]) return Response.json({ error: messages[code] }, { status: 409 });
  if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return Response.json({ error: messages.MRI_CHANGED }, { status: 409 });
  return Response.json({ error: "MRI preparation could not be completed. Reload to check the saved state before retrying." }, { status: 500 });
}
const headers = { "cache-control": "no-store" };
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("mri.view");
    const month = new URL(request.url).searchParams.get("month");
    if (month !== null) return Response.json(await mriSourceReview(scope, month), { headers });
    let canManage = false;
    try { canManage = (await requirePermissionScope("mri.manage")).unrestrictedFacilities; } catch { /* view only */ }
    return Response.json({ configuration: await mriConfiguration(scope), canManage }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("mri.manage");
    const input = JSON.parse((await boundedBody(new Response(request.body), 8000)).toString());
    return Response.json({ configuration: await saveMriConfiguration(scope, input) }, { headers });
  } catch (error) { return failure(error); }
}

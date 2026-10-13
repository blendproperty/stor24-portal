import { z } from "zod";
import { requirePermissionScope } from "@/lib/scope";
import { sameOrigin, rateLimit } from "@/lib/request-security";
import { boundedBody } from "@/lib/payments/netcash-mandate";
import { checkMriConnection, mriSandboxWorkspace, prepareStoredMriSandbox } from "@/lib/mri-service";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), sourceRevision: z.string().datetime(), revision: z.string().datetime().nullable() }).strict(),
  z.object({ action: z.literal("check"), revision: z.string().datetime() }).strict(),
]);
const messages: Record<string, string> = {
  MRI_CHANGED: "Connection settings changed. Reload before testing again.",
  MRI_SANDBOX_UNAVAILABLE: "The stored account must discover exactly one BlendTest database. Refresh discovery in MRI accounting first.",
  MRI_SANDBOX_TARGET: "MRI did not verify the exact BlendTest target. Sandbox access remains unverified.",
  MRI_SANDBOX_SHARED_TARGET: "The test database matches the primary accounting target. Separate the targets before using the sandbox.",
  MRI_DUPLICATE_CONFIG: "Multiple MRI configurations need administrator review.",
  MRI_CONFIG_VERSION: "The saved MRI configuration needs administrator review.",
  MRI_CREDENTIALS: "A stored API account is required. Configure MRI accounting first.",
  MRI_ENCRYPTION: "Secure integration storage must be configured first.",
};
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "UNAUTHENTICATED" ? 401 : ["FORBIDDEN", "MRI_ORG_PERMISSION"].includes(code) ? 403 : error instanceof z.ZodError || error instanceof SyntaxError || ["MANDATE_RESPONSE_TOO_LARGE", "MANDATE_RESPONSE_INVALID"].includes(code) ? 400 : messages[code] || (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) ? 409 : 500;
  return Response.json({ error: messages[code] ?? (status === 401 ? "Sign in is required." : status === 403 ? "Organisation-wide MRI permission is required." : status === 400 ? "Choose a supported sandbox action and reload its saved version." : status === 409 ? messages.MRI_CHANGED : "Sandbox check could not complete. Reload to check the saved state.") }, { status, headers });
}
export async function GET() {
  try {
    const scope = await requirePermissionScope("mri.view");
    let canManage = false; try { canManage = (await requirePermissionScope("mri.manage")).unrestrictedFacilities; } catch { /* read only */ }
    return Response.json({ ...await mriSandboxWorkspace(scope), canManage }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new Error("FORBIDDEN");
    const scope = await requirePermissionScope("mri.manage");
    if (!scope.unrestrictedFacilities) throw new Error("MRI_ORG_PERMISSION");
    const command = commandSchema.parse(JSON.parse((await boundedBody(new Response(request.body), 3000)).toString()));
    if (await rateLimit(`mri-sandbox:${scope.organisationId}`, 3, 300000)) return Response.json({ error: "Wait five minutes before another sandbox preparation or check." }, { status: 429, headers });
    if (command.action === "prepare") {
      const { sourceRevision, revision } = command;
      return Response.json(await prepareStoredMriSandbox(scope, { sourceRevision, revision }), { headers });
    }
    await checkMriConnection(scope, command.revision, fetch, "sandbox");
    return Response.json(await mriSandboxWorkspace(scope), { headers });
  } catch (error) { return failure(error); }
}

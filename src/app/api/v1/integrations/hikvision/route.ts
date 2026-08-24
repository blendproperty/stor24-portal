import { ZodError } from "zod";

import { authErrorResponse } from "@/lib/auth-guards";
import { listHikCentralConfiguration, saveHikCentralCredentials, saveHikCentralMapping, testHikCentralConnection } from "@/lib/integrations/hikcentral-configuration";
import { requirePermissionScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

function configurationError(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the highlighted Hikvision configuration values.", fields: error.flatten().fieldErrors } }, { status: 422 });
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code.startsWith("CONFIG_REQUIRED:") || ["HIKCENTRAL_ENDPOINT_INVALID", "HIKCENTRAL_CREDENTIALS_REQUIRED", "FACILITY_FORBIDDEN"].includes(code)) {
    const messages: Record<string, string> = {
      "CONFIG_REQUIRED:INTEGRATION_CONFIG_ENCRYPTION_KEY": "Secure integration storage must be enabled on the Stor24 server before credentials can be saved.",
      HIKCENTRAL_ENDPOINT_INVALID: "Use the approved HTTPS HikCentral OpenAPI server address.",
      HIKCENTRAL_CREDENTIALS_REQUIRED: "Enter the App Key and App Secret before saving.",
      FACILITY_FORBIDDEN: "You do not have access to configure this facility.",
    };
    return Response.json({ error: { code, message: messages[code] ?? "The Hikvision configuration is incomplete." } }, { status: 422 });
  }
  return authErrorResponse(error);
}

export async function GET() {
  try {
    const viewScope = await requirePermissionScope("integrations.view");
    let canManage = true;
    try { await requirePermissionScope("integrations.manage"); } catch { canManage = false; }
    return Response.json({ data: await listHikCentralConfiguration(viewScope), meta: { canManage } });
  } catch (error) { return configurationError(error); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { action?: string; payload?: unknown };
    const scope = await requirePermissionScope("integrations.manage");
    if (body.action === "save-credentials") await saveHikCentralCredentials(scope, body.payload);
    else if (body.action === "save-mapping") await saveHikCentralMapping(scope, body.payload);
    else return Response.json({ error: { code: "UNKNOWN_ACTION", message: "Choose a supported Hikvision configuration action." } }, { status: 400 });
    return Response.json({ data: await listHikCentralConfiguration(scope) });
  } catch (error) { return configurationError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; facilityId?: string };
    const scope = await requirePermissionScope("integrations.manage", body.facilityId);
    if (body.action !== "test-connection" || !body.facilityId) return Response.json({ error: { code: "UNKNOWN_ACTION", message: "Select a facility to test." } }, { status: 400 });
    const result = await testHikCentralConnection(scope, body.facilityId);
    return Response.json({ data: result, configuration: await listHikCentralConfiguration(scope) }, { status: result.ok ? 200 : 422 });
  } catch (error) { return configurationError(error); }
}

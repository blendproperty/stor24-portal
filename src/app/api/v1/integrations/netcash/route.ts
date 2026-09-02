import { ZodError } from "zod";

import { authErrorResponse } from "@/lib/auth-guards";
import {
  listNetcashConfiguration,
  NetcashProviderValidationError,
  summariseNetcashValidation,
  validateAndSaveNetcashConfiguration,
} from "@/lib/integrations/netcash-configuration";
import { requirePermissionScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

function netcashError(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Check the Netcash test-account number and service keys.", fields: error.flatten().fieldErrors } }, { status: 422 });
  if (error instanceof NetcashProviderValidationError) {
    const diagnostic = summariseNetcashValidation(error.validation);
    const failures = [
      diagnostic.account.valid ? null : `Account ${diagnostic.account.status}: ${diagnostic.account.message}`,
      ...diagnostic.services.filter((item) => !item.valid).map((item) => `${item.label} ${item.status}: ${item.message}`),
    ].filter(Boolean);
    return Response.json({
      error: {
        code: "NETCASH_KEYS_NOT_VALIDATED",
        message: failures.length ? `Netcash rejected part of the test configuration. ${failures.join(". ")}. No credentials were stored.` : "Netcash did not validate every supplied test key. No credentials were stored.",
        diagnostic,
      },
    }, { status: 422 });
  }
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const message = code === "NETCASH_RESPONSE_INVALID"
    ? "Netcash returned an unexpected validation response. No credentials were stored."
    : code.startsWith("NETCASH_HTTP_") || code.startsWith("NETCASH_SOAP_FAULT")
      ? "The Netcash validation service could not confirm the credentials. No credentials were stored. Check System Audit for the failure code before retrying."
      : code === "CONFIG_REQUIRED:INTEGRATION_CONFIG_ENCRYPTION_KEY"
        ? "Secure integration storage must be enabled on the Stor24 server before Netcash credentials can be saved."
        : null;
  return message ? Response.json({ error: { code: code.split(":")[0], message } }, { status: 422 }) : authErrorResponse(error);
}

export async function GET() {
  try {
    const scope = await requirePermissionScope("integrations.view");
    let canManage = true;
    try { await requirePermissionScope("integrations.manage"); } catch { canManage = false; }
    return Response.json({ data: await listNetcashConfiguration(scope), meta: { canManage } });
  } catch (error) { return netcashError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; payload?: unknown };
    if (body.action !== "validate-and-save") return Response.json({ error: { code: "UNKNOWN_ACTION", message: "Choose the Netcash test-credential validation action." } }, { status: 400 });
    const scope = await requirePermissionScope("integrations.manage");
    const validation = await validateAndSaveNetcashConfiguration(scope, body.payload);
    return Response.json({ data: await listNetcashConfiguration(scope), validation, diagnostic: summariseNetcashValidation(validation) });
  } catch (error) { return netcashError(error); }
}

import { z } from "zod";
import { boundedBody } from "@/lib/payments/netcash-mandate";

// MRI's official /api/swagger/docs/v1 describes OAuth password grant for v2.
// The similarly named v1 journal API documents a different auth contract.
export const MRI_API_BASE = "https://api.mdapropsys.com/api";
const tokenSchema = z.object({ access_token: z.string().min(1).max(16000), token_type: z.string().regex(/^bearer$/i) });
const databasesSchema = z.array(z.object({ DatabaseName: z.string().min(1).max(200), DatabaseIdentifier: z.string().min(1).max(200) })).max(100);
const propertiesSchema = z.object({ ResultCount: z.number().int().nonnegative(), ResultSet: z.array(z.unknown()).max(1) });
async function json(response: Response) {
  try { return JSON.parse((await boundedBody(response, 128000)).toString()); }
  catch { throw new Error("MRI_RESPONSE_INVALID"); }
}
async function request(path: string, init: RequestInit, fetcher: typeof fetch) {
  let response: Response;
  try { response = await fetcher(`${MRI_API_BASE}${path}`, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error("MRI_NETWORK"); }
  if (!response.ok) {
    // Never echo token bodies, passwords, headers or provider diagnostics.
    await response.body?.cancel();
    throw new Error(response.status === 401 || response.status === 403 || (path === "/v2/Token" && response.status === 400) ? "MRI_AUTH_REJECTED" : "MRI_PROVIDER_UNAVAILABLE");
  }
  return json(response);
}

/** Only authentication and reads. Tokens remain in memory for this invocation. */
export async function verifyMriAccess(credentials: { login: string; password: string; databaseIdentifier?: string }, fetcher: typeof fetch = fetch) {
  const raw = await request("/v2/Token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "password", username: credentials.login, password: credentials.password }).toString(),
  }, fetcher);
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) throw new Error("MRI_RESPONSE_INVALID");
  const headers = { authorization: `Bearer ${parsed.data.access_token}`, accept: "application/json" };
  let databases: z.infer<typeof databasesSchema> = [], discoveryAvailable = false;
  // This read route is published by MRI's own Web client. It is not in the
  // pre-approved Swagger list; an API user may be denied. Do not infer no access.
  try {
    const found = databasesSchema.safeParse(await request("/v2/Access/GetDatabaseAccessList", { method: "GET", headers }, fetcher));
    if (found.success) { databases = found.data; discoveryAvailable = true; }
  } catch { /* Manual provider-supplied identifier remains available. */ }
  if (!credentials.databaseIdentifier) return { authenticated: true as const, databaseReadable: false, discoveryAvailable, databases, propertyCount: null };
  const result = propertiesSchema.safeParse(await request("/v2/Properties/SearchProperties", {
    method: "POST", headers: { ...headers, "content-type": "application/json", DatabaseIdentifier: credentials.databaseIdentifier },
    body: JSON.stringify({ PageIndex: 0, PageSize: 1 }),
  }, fetcher));
  if (!result.success) throw new Error("MRI_RESPONSE_INVALID");
  return { authenticated: true as const, databaseReadable: true, discoveryAvailable, databases, propertyCount: result.data.ResultCount };
}

import { after } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { sameOrigin, requestIp, privacyHash } from "@/lib/request-security";
import { endTenantSession, setTenantCookie, startTenantChallenge, tenantRateLimit, verifyTenantChallenge } from "@/lib/tenant-portal-auth";
import { tenantToken, tenantCodeHash, TENANT_CHALLENGE_COOKIE, TENANT_CODE_MS, TENANT_SESSION_COOKIE, TENANT_SESSION_MS } from "@/lib/tenant-portal-security";

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: "Request rejected." }, { status: 403 });
  const { action } = await params;
  try {
    if (action === "logout") { await endTenantSession(); return Response.json({ ok: true }); }
    if (action !== "start" && action !== "verify") return Response.json({ error: "Not found." }, { status: 404 });
    // Validate configuration before deriving private rate-limit keys.
    tenantCodeHash("configuration-check", "000000");
    if (await tenantRateLimit(`tenant:${action}:ip:${privacyHash(requestIp(request))}`, action === "start" ? 20 : 40, 3600000)) return Response.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    const input = await request.json();
    if (action === "start") {
      const parsed = z.object({ organisation: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) }).parse(input);
      if (await tenantRateLimit(`tenant:start:email:${privacyHash(`${parsed.organisation}:${parsed.email}`)}`, 3, TENANT_CODE_MS)) return Response.json({ error: "Please wait before requesting another code." }, { status: 429 });
      const id = tenantToken();
      await setTenantCookie(TENANT_CHALLENGE_COOKIE, id, TENANT_CODE_MS / 1000);
      // Both known and unknown emails return before lookup/delivery to avoid enumeration by provider latency.
      after(async () => { await startTenantChallenge(parsed.organisation, parsed.email, id); });
      return Response.json({ message: "If this email is verified on an eligible STOR24 account, a code will arrive shortly. Check your inbox and spam folder." }, { headers: { "Cache-Control": "no-store" } });
    }
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(input);
    const id = (await cookies()).get(TENANT_CHALLENGE_COOKIE)?.value;
    if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error("TENANT_INVALID_CODE");
    const token = await verifyTenantChallenge(id, code);
    await setTenantCookie(TENANT_SESSION_COOKIE, token, TENANT_SESSION_MS / 1000);
    (await cookies()).delete(TENANT_CHALLENGE_COOKIE);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Please check the details and try again." }, { status: 422 });
    if (error instanceof Error && error.message === "TENANT_INVALID_CODE") return Response.json({ error: "That code is invalid or expired. Request a new code if needed." }, { status: 401 });
    return Response.json({ error: "Sign-in is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
}

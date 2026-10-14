import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { endWalkIn, redeemWalkIn, walkInView } from "@/lib/walk-in-service";
import { z } from "zod";
import { privacyHash, rateLimit, requestIp } from "@/lib/request-security";
const input = z.union([
  z.object({ action: z.enum(["redeem", "view", "end"]), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("redeem-code"), token: z.string().min(8).max(16) }).strict(),
]);
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401, headers });
  try {
    const value = input.parse(await request.json());
    if (value.action === "redeem" || value.action === "redeem-code") {
      const ip = privacyHash(request.headers.get("x-stor24-client-ip")?.slice(0, 128) || requestIp(request));
      if (await rateLimit(`walk-in-redeem:${ip}`, 15, 5 * 60_000) || (value.action === "redeem-code" && await rateLimit("walk-in-code:global", 1200, 5 * 60_000))) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Wait five minutes before trying again." } }, { status: 429, headers });
    }
    const data = value.action === "redeem" || value.action === "redeem-code" ? await redeemWalkIn(value.token, value.action === "redeem-code" ? "code" : "token") : value.action === "view" ? await walkInView(value.token) : (await endWalkIn(value.token), { cleared: true });
    return Response.json({ data }, { headers });
  } catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof Error && error.message === "WALK_IN_UNAVAILABLE")) return Response.json({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "Reconnect and retry. Your visit has not been cleared." } }, { status: 503, headers });
    return Response.json({ error: { code: "WALK_IN_UNAVAILABLE", message: "This tablet visit has ended. Ask staff to start a new visit." } }, { status: 410, headers }); }
}

import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { endWalkIn, redeemWalkIn, walkInView } from "@/lib/walk-in-service";
import { z } from "zod";
const input = z.object({ action: z.enum(["redeem", "view", "end"]), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401, headers });
  try {
    const value = input.parse(await request.json());
    const data = value.action === "redeem" ? await redeemWalkIn(value.token) : value.action === "view" ? await walkInView(value.token) : (await endWalkIn(value.token), { cleared: true });
    return Response.json({ data }, { headers });
  } catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof Error && error.message === "WALK_IN_UNAVAILABLE")) return Response.json({ error: { code: "TEMPORARILY_UNAVAILABLE", message: "Reconnect and retry. Your visit has not been cleared." } }, { status: 503, headers });
    return Response.json({ error: { code: "WALK_IN_UNAVAILABLE", message: "This tablet visit has ended. Ask staff to start a new visit." } }, { status: 410, headers }); }
}

import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { marketingABC, missingABC } from "@/lib/marketing-abc";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const scope = await requirePermissionScope("leads.view");
    if (!scope.unrestrictedFacilities || (process.env.GA4_ORGANISATION_ID && scope.organisationId !== process.env.GA4_ORGANISATION_ID)) throw Error("FORBIDDEN");
    const query = new URL(request.url).searchParams;
    const parsed = z.object({ from: z.iso.date(), to: z.iso.date(), channel: z.string().max(160).optional(), source: z.string().max(160).optional(), campaign: z.string().max(160).optional(), device: z.enum(["desktop", "mobile", "tablet", "smart tv", ""]).optional() }).safeParse(Object.fromEntries(query));
    if (!parsed.success || parsed.data.from > parsed.data.to || parsed.data.to > southAfricaDateKey(new Date()) || new Date(parsed.data.to).getTime() - new Date(parsed.data.from).getTime() > 89 * 86400000) return Response.json({ error: { message: "Choose a valid ABC period of up to 90 days." } }, { status: 422 });
    const { from, to, ...filters } = parsed.data;
    return Response.json({ data: process.env.GA4_ORGANISATION_ID ? await marketingABC(from, to, filters) : missingABC("unconfigured") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

import { apiError } from "@/lib/api";
import { requirePermissionScope } from "@/lib/scope";
import { marketingTraffic } from "@/lib/marketing-ga";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    // Property-wide traffic is available only to users whose view permission covers all stores.
    const scope = await requirePermissionScope("leads.view");
    if (!scope.unrestrictedFacilities) throw Error("FORBIDDEN");
    if (
      process.env.GA4_ORGANISATION_ID &&
      scope.organisationId !== process.env.GA4_ORGANISATION_ID
    )
      throw Error("FORBIDDEN");
    if (!process.env.GA4_ORGANISATION_ID)
      return Response.json(
        {
          data: {
            status: "unconfigured",
            message:
              "Google Analytics reporting needs an organisation-scoped read-only connection.",
            days: [],
            totals: null,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    const query = new URL(request.url).searchParams,
      range = z
        .object({ from: z.iso.date(), to: z.iso.date() })
        .safeParse({ from: query.get("from"), to: query.get("to") });
    if (
      !range.success ||
      range.data.from > range.data.to ||
      range.data.to > southAfricaDateKey(new Date()) ||
      new Date(range.data.to).getTime() - new Date(range.data.from).getTime() >
        365 * 86400000
    )
      return Response.json(
        { error: { message: "Choose a valid date range of up to one year." } },
        { status: 422 },
      );
    return Response.json(
      { data: await marketingTraffic(range.data.from, range.data.to) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}

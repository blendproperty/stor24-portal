import { db } from "@/lib/db";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { releaseExpiredPublicReservations } from "@/lib/public-booking-service";

const noStore = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  if (!publicApiAuthorized(request))
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Request rejected." } }, { status: 401 });

  await releaseExpiredPublicReservations();

  const facilities = await db.facility.findMany({
    where: { active: true, publicBookingEnabled: true, publicSlug: { not: null } },
    select: {
      name: true,
      publicSlug: true,
      address: true,
      maps: { select: { name: true }, orderBy: { name: "asc" } },
      _count: { select: { units: { where: { status: "AVAILABLE" } } } },
    },
    orderBy: { name: "asc" },
  });

  return Response.json({
    data: facilities.map((facility) => ({
      name: facility.name,
      slug: facility.publicSlug,
      address: facility.address,
      availableUnitCount: facility._count.units,
      floors: facility.maps.map((map) => map.name),
    })),
    meta: { count: facilities.length },
  }, { headers: noStore });
}

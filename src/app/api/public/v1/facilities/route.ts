import { floorIsOperational, unitIsOperational, floorMapSelection } from "@/lib/floor-availability";
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
      closedFloors: true,
      publicSlug: true,
      address: true,
      maps: { select: { name: true }, orderBy: { name: "asc" } },
      units: { where: { status: "AVAILABLE" }, select: { floor: true, mapElements: floorMapSelection } },
    },
    orderBy: { name: "asc" },
  });

  return Response.json({
    data: facilities.map((facility) => ({
      name: facility.name,
      slug: facility.publicSlug,
      address: facility.address,
      availableUnitCount: facility.units.filter(unit => unitIsOperational(unit, facility.closedFloors)).length,
      floors: facility.maps.filter(map => floorIsOperational(map.name, facility.closedFloors)).map((map) => map.name),
    })),
    meta: { count: facilities.length },
  }, { headers: noStore });
}

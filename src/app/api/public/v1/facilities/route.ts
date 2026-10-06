import { floorIsOperational, unitIsOperational, floorMapSelection } from "@/lib/floor-availability";
import { db } from "@/lib/db";
import { publicApiAuthorized } from "@/lib/public-booking-contract";
import { releaseExpiredPublicReservations } from "@/lib/public-booking-service";

import { productLineFromRequest, unitSupportsProduct } from "@/lib/product-line";
const noStore = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  if (!publicApiAuthorized(request))
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Request rejected." } }, { status: 401 });

  const product = productLineFromRequest(request);
  if (!product) return Response.json({ error: { code: "INVALID_PRODUCT" } }, { status: 400 });
  await releaseExpiredPublicReservations();

  const facilities = await db.facility.findMany({
    where: { active: true, publicBookingEnabled: true, publicSlug: { not: null } },
    select: {
      name: true,
      closedFloors: true,
      publicSlug: true,
      address: true,
      maps: { select: { name: true }, orderBy: { name: "asc" } },
      units: { select: { status: true, monthlyRate: true, floor: true, useTypesOverride: true, unitType: { select: { useTypes: true } }, mapElements: floorMapSelection } },
    },
    orderBy: { name: "asc" },
  });

  return Response.json({
    data: facilities.filter(f => product === "STORAGE" || f.units.some(u => unitSupportsProduct(u, product))).map((facility) => ({
      name: facility.name,
      slug: facility.publicSlug,
      address: facility.address,
      availableUnitCount: facility.units.filter(unit => unit.status === "AVAILABLE" && unitIsOperational(unit, facility.closedFloors) && unitSupportsProduct(unit, product)).length,
      fromMonthlyRateZar: Math.min(...facility.units.filter(u => u.status === "AVAILABLE" && unitSupportsProduct(u, product) && unitIsOperational(u, facility.closedFloors)).map(u => Number(u.monthlyRate))) || null,
      floors: facility.maps.filter(map => floorIsOperational(map.name, facility.closedFloors)).map((map) => map.name),
    })),
    meta: { count: facilities.length },
  }, { headers: { ...noStore, "x-stor24-product-line": product } });
}

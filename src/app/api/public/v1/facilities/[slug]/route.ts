import { db } from "@/lib/db";
import {
  publicApiAuthorized,
  publicAvailability,
  publicElementConfig,
} from "@/lib/public-booking-contract";

const noStore = { "cache-control": "private, no-store, max-age=0" };
const publicStoreKeys = [
  "dbaName", "address1", "address2", "city", "province", "postalCode", "country",
  "mobile", "email", "websiteUrl", "directions", "latitude", "longitude",
  "weekdayClosed", "weekdayStart", "weekdayEnd", "saturdayClosed", "saturdayStart",
  "saturdayEnd", "sundayClosed", "sundayStart", "sundayEnd",
] as const;

function safeStoreInformation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return Object.fromEntries(publicStoreKeys.flatMap((key) => {
    const item = input[key];
    return typeof item === "string" || typeof item === "boolean" ? [[key, item]] : [];
  }));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!publicApiAuthorized(request))
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Request rejected." } }, { status: 401 });
  const { slug } = await context.params;
  const facility = await db.facility.findFirst({
    where: { publicSlug: slug.toLowerCase(), active: true, publicBookingEnabled: true },
    select: {
      name: true,
      publicSlug: true,
      timezone: true,
      address: true,
      configurationProfiles: {
        where: { domain: "STORE_INFORMATION", name: "Default", status: "READY" },
        select: { config: true },
        take: 1,
      },
      units: {
        select: {
          id: true, number: true, floor: true, zone: true, status: true,
          monthlyRate: true, taxRate: true,
          unitType: { select: { name: true, widthMetres: true, lengthMetres: true, areaSqMetres: true, features: true } },
        },
        orderBy: { number: "asc" },
      },
      maps: {
        select: {
          id: true, name: true, width: true, height: true,
          elements: {
            select: {
              id: true, type: true, x: true, y: true, width: true, height: true,
              rotation: true, label: true, config: true, sortOrder: true,
              unit: {
                select: {
                  id: true, number: true, status: true, monthlyRate: true, taxRate: true,
                  unitType: { select: { name: true, widthMetres: true, lengthMetres: true, areaSqMetres: true, features: true } },
                },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!facility)
    return Response.json({ error: { code: "NOT_FOUND", message: "Store not found." } }, { status: 404 });

  const unitView = (unit: (typeof facility.units)[number]) => ({
    id: unit.id,
    number: unit.number,
    floor: unit.floor,
    zone: unit.zone,
    availability: publicAvailability(unit.status),
    monthlyRateZar: Number(unit.monthlyRate.toString()),
    vatRate: Number(unit.taxRate.toString()),
    type: {
      name: unit.unitType.name,
      widthMetres: unit.unitType.widthMetres ? Number(unit.unitType.widthMetres.toString()) : null,
      lengthMetres: unit.unitType.lengthMetres ? Number(unit.unitType.lengthMetres.toString()) : null,
      areaSqMetres: unit.unitType.areaSqMetres ? Number(unit.unitType.areaSqMetres.toString()) : null,
      features: unit.unitType.features,
    },
  });

  return Response.json({ data: {
    name: facility.name,
    slug: facility.publicSlug,
    timezone: facility.timezone,
    address: facility.address,
    storeInformation: safeStoreInformation(facility.configurationProfiles[0]?.config),
    units: facility.units.map(unitView),
    maps: facility.maps.map((map) => ({
      id: map.id,
      name: map.name,
      width: map.width,
      height: map.height,
      elements: map.elements.map((element) => ({
        id: element.id,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        label: element.unit?.number ?? element.label,
        sortOrder: element.sortOrder,
        config: publicElementConfig(element.config),
        unit: element.unit ? {
          id: element.unit.id,
          number: element.unit.number,
          availability: publicAvailability(element.unit.status),
          monthlyRateZar: Number(element.unit.monthlyRate.toString()),
          vatRate: Number(element.unit.taxRate.toString()),
          type: {
            name: element.unit.unitType.name,
            widthMetres: element.unit.unitType.widthMetres ? Number(element.unit.unitType.widthMetres.toString()) : null,
            lengthMetres: element.unit.unitType.lengthMetres ? Number(element.unit.unitType.lengthMetres.toString()) : null,
            areaSqMetres: element.unit.unitType.areaSqMetres ? Number(element.unit.unitType.areaSqMetres.toString()) : null,
            features: element.unit.unitType.features,
          },
        } : null,
      })),
    })),
  } }, { headers: noStore });
}

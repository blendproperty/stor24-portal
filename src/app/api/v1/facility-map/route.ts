import { floorIsOperational } from "@/lib/floor-availability";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { apiError, jsonBody } from "@/lib/api";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/request-security";
import { requireFacility, requireScope } from "@/lib/scope";

const elementSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(["UNIT", "ZONE", "WALL", "FIRE_WALL", "PARTITION_WALL", "DOOR", "WINDOW", "LABEL", "ROLLER_SHUTTER", "SINGLE_DOOR", "DOUBLE_DOOR", "STAIRS", "RETURN_STAIRS", "LIFT", "TABLE", "CHAIR", "CUPBOARD", "ROOF"]),
  x: z.number().int().min(0).max(5000), y: z.number().int().min(0).max(5000), width: z.number().int().min(2).max(3000), height: z.number().int().min(2).max(3000),
  rotation: z.number().int().min(0).max(359).default(0), label: z.string().trim().max(120).optional(), unitId: z.string().optional(),
  mirrored: z.boolean().default(false),
  flippedVertical: z.boolean().default(false),
  unit: z.object({ unitTypeId: z.string().min(1), number: z.string().trim().min(1).max(40), floor: z.string().trim().max(40).optional(), zone: z.string().trim().max(40).optional(), monthlyRate: z.coerce.number().min(0), taxRate: z.coerce.number().min(0).max(1).default(.15) }).optional(),
});
const mapSchema = z.object({ facilityId: z.string().min(1), name: z.string().trim().min(1).max(80), width: z.number().int().min(400).max(5000), height: z.number().int().min(300).max(5000), backgroundUrl: z.string().trim().max(500).nullable().optional(), elements: z.array(elementSchema).max(1500) });

export async function GET(request: Request) {
  try {
    const auth = await requirePermission("facility_map.view"); const scope = await requireScope();
    const facilityId = new URL(request.url).searchParams.get("facilityId");
    if (facilityId) await requireFacility(scope, facilityId);
    const facilities = await db.facility.findMany({ where: { organisationId: auth.organisationId, active: true, ...(auth.allowedFacilityIds ? { id: { in: auth.allowedFacilityIds } } : {}), ...(facilityId ? { id: facilityId } : {}) }, include: { unitTypes: { orderBy: { name: "asc" } }, units: { include: { unitType: true }, orderBy: { number: "asc" } }, maps: { include: { elements: { include: { unit: { include: { unitType: true } } }, orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
    return Response.json({ data: facilities.map(facility => ({ ...facility, maps: facility.maps.map(map => ({ ...map, elements: map.elements.map(element => ({ ...element, unit: element.unit ? { ...element.unit, floorOperational: floorIsOperational(element.unit.floor, facility.closedFloors) && floorIsOperational(map.name, facility.closedFloors) } : null })) })) })) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 403 });
    const scope = await requireScope(); const parsed = mapSchema.safeParse(await jsonBody(request));
    if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const input = parsed.data; await requirePermission("inventory.manage", input.facilityId); await requireFacility(scope, input.facilityId);
    const placedUnitIds = input.elements.flatMap((element) => element.unitId ? [element.unitId] : []);
    const repeatedUnitId = placedUnitIds.find((id, index) => placedUnitIds.indexOf(id) !== index);
    if (repeatedUnitId) {
      const unit = await db.unit.findFirst({ where: { id: repeatedUnitId, facilityId: input.facilityId } });
      return Response.json({ error: { code: "DUPLICATE_UNIT_PLACEMENT", message: `Unit ${unit?.number ?? repeatedUnitId} is placed more than once on this layout.` } }, { status: 409 });
    }
    const draftNumbers = input.elements.flatMap((element) => element.unit ? [element.unit.number.trim()] : []);
    const repeatedDraftNumber = draftNumbers.find((number, index) => draftNumbers.findIndex((item) => item.toLowerCase() === number.toLowerCase()) !== index);
    if (repeatedDraftNumber) return Response.json({ error: { code: "DUPLICATE_UNIT_NUMBER", message: `Unit number ${repeatedDraftNumber} is used more than once. Every unit in a store needs a unique number.` } }, { status: 409 });
    const existingNumber = draftNumbers.length ? await db.unit.findFirst({ where: { facilityId: input.facilityId, number: { in: draftNumbers } } }) : null;
    if (existingNumber) return Response.json({ error: { code: "UNIT_NUMBER_EXISTS", message: `Unit number ${existingNumber.number} already exists at this store. Place the existing unit or choose another number.` } }, { status: 409 });
    const result = await db.$transaction(async (tx) => {
      const map = await tx.facilityMap.upsert({ where: { facilityId_name: { facilityId: input.facilityId, name: input.name } }, update: { width: input.width, height: input.height, backgroundUrl: input.backgroundUrl }, create: { facilityId: input.facilityId, name: input.name, width: input.width, height: input.height, backgroundUrl: input.backgroundUrl } });
      await tx.mapElement.deleteMany({ where: { mapId: map.id } });
      const existingUnitIds = [...new Set(input.elements.flatMap((element) => element.type === "UNIT" && element.unitId ? [element.unitId] : []))];
      if (existingUnitIds.length) {
        const existingUnitCount = await tx.unit.count({ where: { facilityId: input.facilityId, id: { in: existingUnitIds } } });
        if (existingUnitCount !== existingUnitIds.length) throw new Error("CONFLICT");
      }
      const draftTypeIds = [...new Set(input.elements.flatMap((element) => element.type === "UNIT" && !element.unitId && element.unit ? [element.unit.unitTypeId] : []))];
      if (draftTypeIds.length) {
        const draftTypeCount = await tx.unitType.count({ where: { facilityId: input.facilityId, id: { in: draftTypeIds } } });
        if (draftTypeCount !== draftTypeIds.length) throw new Error("CONFLICT");
      }
      const elementRows: Prisma.MapElementCreateManyInput[] = [];
      const createdUnits: Array<{ elementId: string; unit: Awaited<ReturnType<typeof tx.unit.create>> }> = [];
      for (const [sortOrder, element] of input.elements.entries()) {
        let unitId = element.unitId;
        if (element.type === "UNIT") {
          if (!unitId) {
            if (!element.unit) throw new Error("CONFLICT");
            const unit = await tx.unit.create({ data: { facilityId: input.facilityId, ...element.unit, status: "AVAILABLE" }, include: { unitType: true } }); unitId = unit.id;
            createdUnits.push({ elementId: element.id, unit });
          }
        }
        elementRows.push({ mapId: map.id, unitId, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, label: element.label, config: element.unit || element.mirrored || element.flippedVertical ? { ...(element.unit ? { draftUnit: element.unit } : {}), mirrored: element.mirrored, flippedVertical: element.flippedVertical } : undefined, sortOrder });
      }
      if (elementRows.length) await tx.mapElement.createMany({ data: elementRows });
      await tx.auditEvent.create({ data: { organisationId: scope.organisationId, facilityId: input.facilityId, actorId: scope.userId, action: "facility_map.saved", entityType: "FacilityMap", entityId: map.id, after: { name: map.name, elementCount: input.elements.length } } });
      return { map, createdUnits };
    });
    return Response.json({ data: result });
  } catch (error) { return apiError(error); }
}

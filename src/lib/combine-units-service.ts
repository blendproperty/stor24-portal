import { db } from "@/lib/db";
import { unitIsOperational } from "@/lib/floor-availability";
import { adjacentUnitBounds,combinationToken } from "@/lib/unit-combination";
import { requireFacility,type RequestScope } from "@/lib/scope";
import type { Prisma } from "@/generated/prisma/client";
export type CombineInput={facilityId:string;unitIds:string[];action:"preview"|"apply";physicalConnectionConfirmed:boolean;expectedToken?:string};
export async function combineUnits(scope:RequestScope,input:CombineInput){
 await requireFacility(scope,input.facilityId);
 const result=await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id"=${input.facilityId} FOR UPDATE`;
 const ids=[...new Set(input.unitIds)].sort();for(const id of ids)await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id"=${id} AND "facilityId"=${input.facilityId} FOR UPDATE`;
 const units=await tx.unit.findMany({where:{id:{in:ids},facilityId:input.facilityId},include:{unitType:true,facility:{select:{closedFloors:true}},mapElements:{include:{map:{select:{name:true}}}},reservations:{where:{status:{in:["ACTIVE","CONVERTED"]}}},occupancies:{where:{status:{in:["PENDING","ACTIVE","NOTICE_GIVEN"]}}}}});
 units.sort((a,b)=>a.id.localeCompare(b.id));
 if(units.length!==ids.length)throw new Error("FORBIDDEN");
 if(units.length!==2)throw new Error("Select two units.");const [a,b]=units;
 if(units.some(u=>u.status!=="AVAILABLE"||u.combinedIntoUnitId||u.combinationSnapshot||u.reservations.length||u.occupancies.length||!unitIsOperational(u,u.facility.closedFloors)))throw new Error("Both units must be operational, available and free of active bookings or existing combinations.");
 if(a.floor!==b.floor||a.taxRate.toString()!==b.taxRate.toString())throw new Error("Units must share a floor and tax rate.");
 const first=a.mapElements[0],second=b.mapElements[0];if(!first||!second)throw new Error("Both units need saved map positions.");const bounds=adjacentUnitBounds(first,second);
 const area=Number(a.unitType.areaSqMetres)+Number(b.unitType.areaSqMetres);if(!a.unitType.areaSqMetres||!b.unitType.areaSqMetres||area<23)throw new Error("Record the authoritative area for both units first.");const monthlyRate=Number(a.monthlyRate)+Number(b.monthlyRate);
 const snapshot={components:units.map(u=>({id:u.id,number:u.number,unitTypeId:u.unitTypeId,monthlyRate:u.monthlyRate.toString(),useTypesOverride:u.useTypesOverride,businessAttributesOverride:u.businessAttributesOverride})),mapElements:[first,second].map(e=>({id:e.id,mapId:e.mapId,unitId:e.unitId,type:e.type,x:e.x,y:e.y,width:e.width,height:e.height,rotation:e.rotation,label:e.label,config:e.config,sortOrder:e.sortOrder})),area,monthlyRate};const token=combinationToken(snapshot);
 if(input.action==="preview")return {area,monthlyRate,token};
 if(!input.physicalConnectionConfirmed)throw new Error("Confirm the approved physical connection is complete before combining.");if(input.expectedToken!==token)throw new Error("The units changed since preview. Preview again.");
 const type=await tx.unitType.create({data:{facilityId:input.facilityId,name:`Combined ${a.number}+${b.number} ${area}m2 ${Date.now()}`.slice(0,100),areaSqMetres:area,useTypes:["STORAGE","MICRO_WAREHOUSE"],features:["Combined adjacent units"]}});
 await tx.unit.update({where:{id:b.id},data:{status:"UNAVAILABLE",combinedIntoUnitId:a.id}});
 await tx.unit.update({where:{id:a.id},data:{unitTypeId:type.id,number:`${a.number}+${b.number}`.slice(0,40),monthlyRate,useTypesOverride:["STORAGE","MICRO_WAREHOUSE"],combinationSnapshot:snapshot as Prisma.InputJsonValue}});
 await tx.mapElement.delete({where:{id:second.id}});await tx.mapElement.update({where:{id:first.id},data:{...bounds,label:`${a.number}+${b.number}`}});
 await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:input.facilityId,actorId:scope.userId,action:"units.combined",entityType:"Unit",entityId:a.id,before:snapshot as Prisma.InputJsonValue,after:{primaryUnitId:a.id,blockedComponentUnitId:b.id,area,monthlyRate,physicalConnectionConfirmed:true}}});return {area,monthlyRate,primaryUnitId:a.id};
 });
 return result;
}

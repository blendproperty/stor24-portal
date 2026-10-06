import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {combineUnits} from "../../src/lib/combine-units-service";
import {createReservation} from "../../src/lib/leasing-service";
import {requireEditableCombinationUnit} from "../../src/lib/unit-combination-service";
test("isolated PostgreSQL combination blocks double allocation and stale/unauthorised changes",async()=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
 const key=randomUUID(),org=await db.organisation.create({data:{name:"Combination CI",slug:key}}),facility=await db.facility.create({data:{organisationId:org.id,name:"CI",code:key}}),user=await db.user.create({data:{organisationId:org.id,name:"CI",email:`${key}@example.invalid`}}),customer=await db.customer.create({data:{organisationId:org.id}}),type=await db.unitType.create({data:{facilityId:facility.id,name:"23 sqm",areaSqMetres:23,useTypes:["STORAGE","MICRO_WAREHOUSE"]}});
 const scope={organisationId:org.id,userId:user.id,facilityIds:[facility.id],unrestrictedFacilities:false};
 await db.auditEvent.create({data:{organisationId:org.id,actorId:user.id,entityType:"Customer",entityId:customer.id,action:"customer.created"}});
 const units=await Promise.all(["A","B"].map(number=>db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number,floor:"Ground Floor",monthlyRate:200}})));
 await db.facilityMap.create({data:{facilityId:facility.id,name:"Ground Floor",elements:{create:units.map((u,i)=>({unitId:u.id,type:"UNIT",x:i*80,y:0,width:80,height:100}))}}});
 try{
  const input={facilityId:facility.id,unitIds:units.map(u=>u.id),action:"preview" as const,physicalConnectionConfirmed:false};const preview=await combineUnits(scope,input);assert.equal(preview.area,46);assert.equal(preview.monthlyRate,400);
  await assert.rejects(combineUnits({...scope,facilityIds:[]},input),/FORBIDDEN/);
  await assert.rejects(combineUnits(scope,{...input,action:"apply",expectedToken:preview.token}),/physical connection/);
  await db.unit.update({where:{id:units[0].id},data:{monthlyRate:201}});await assert.rejects(combineUnits(scope,{...input,action:"apply",physicalConnectionConfirmed:true,expectedToken:preview.token}),/changed since preview/);
  const next=await combineUnits(scope,input);await combineUnits(scope,{...input,action:"apply",physicalConnectionConfirmed:true,expectedToken:next.token});
  const records=await db.unit.findMany({where:{facilityId:facility.id},include:{unitType:true}}),component=records.find(u=>u.combinedIntoUnitId)!,primary=records.find(u=>u.combinationSnapshot)!;
  assert.equal(Number(primary.unitType.areaSqMetres),46);assert.equal(Number(primary.monthlyRate),401);assert.equal(component.status,"UNAVAILABLE");assert.equal(component.combinedIntoUnitId,primary.id);assert.equal(await db.mapElement.count({where:{unitId:component.id}}),0);
  await assert.rejects(db.$transaction(tx=>requireEditableCombinationUnit(tx,facility.id,component.id)),/CONFLICT/);
  await assert.rejects(db.unit.update({where:{id:component.id},data:{status:"AVAILABLE"}}));
  await assert.rejects(createReservation(scope,{facilityId:facility.id,unitId:component.id,customerId:customer.id,quotedRate:201}),/UNIT_UNAVAILABLE/);
  const outcomes=await Promise.allSettled([0,1].map(()=>createReservation(scope,{facilityId:facility.id,unitId:primary.id,customerId:customer.id,quotedRate:401})));assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
  assert.equal(await db.auditEvent.count({where:{facilityId:facility.id,action:"units.combined"}}),1);
 }finally{await db.organisation.delete({where:{id:org.id}});await db.$disconnect();}
});

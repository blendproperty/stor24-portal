import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../../src/lib/db";
import { trainingSnapshot, trainingCommand, trainingSample, validateTrainingSample } from "../../src/lib/move-in-training";
import type { TrainingAction } from "../../src/lib/move-in-training-contract";
test("isolated PostgreSQL owner-controlled manager training",async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
 t.mock.method(globalThis,"fetch",()=>{throw new Error("Training attempted external transport");});
 async function fixture(){
  const key=randomUUID();const org=await db.organisation.create({data:{name:"Training CI",slug:key}});
  const facility=await db.facility.create({data:{organisationId:org.id,name:"Allowed",code:key}});
  const other=await db.facility.create({data:{organisationId:org.id,name:"Not assigned",code:key+"-other"}});
  const ownerRole=await db.role.create({data:{organisationId:org.id,name:"Organisation owner",permissions:["*"]}});
  const managerRole=await db.role.create({data:{organisationId:org.id,name:"Facility manager",permissions:["operations.*"]}});
  const owner=await db.user.create({data:{organisationId:org.id,name:"CI owner",email:key+"o@example.invalid",roleAssignments:{create:{roleId:ownerRole.id}}}});
  const manager=await db.user.create({data:{organisationId:org.id,name:"CI manager",email:key+"m@example.invalid",roleAssignments:{create:{roleId:managerRole.id,facilityId:facility.id}}}});
  const outsider=await db.user.create({data:{organisationId:org.id,name:"No role",email:key+"x@example.invalid"}});
  return{org,facility,other,owner,manager,outsider};
 }
 try {
 const f=await fixture();
 await t.test("disabled by default; only current owner can switch; managers keep facility scope",async()=>{
  assert.equal((await trainingSnapshot(f.owner.id)).enabled,false);
  await assert.rejects(trainingCommand(f.manager.id,{action:"toggle",enabled:true,version:0}),/FORBIDDEN/);
  await assert.rejects(trainingSnapshot(f.outsider.id),/FORBIDDEN/);
  await assert.rejects(trainingCommand(f.manager.id,{action:"start",facilityId:f.facility.id}),/DISABLED/);
  const on=await trainingCommand(f.owner.id,{action:"toggle",enabled:true,version:0});assert.equal(on.enabled,true);
  const manager=await trainingSnapshot(f.manager.id);assert.equal(manager.canToggle,false);assert.deepEqual(manager.facilities.map(x=>x.id),[f.facility.id]);
  await assert.rejects(trainingCommand(f.manager.id,{action:"start",facilityId:f.other.id}),/FORBIDDEN/);
 });
 await t.test("complete saved training and photo recovery never create live records",async()=>{
  let snapshot=await trainingCommand(f.manager.id,{action:"start",facilityId:f.facility.id});
  async function step(action:string,value?:string,sample=false){snapshot=await trainingCommand(f.manager.id,{action,facilityId:f.facility.id,version:snapshot.run!.version,value} as TrainingAction,sample);}
  const original=snapshot.run!.version;await step("unit","DEMO-01");
  await assert.rejects(trainingCommand(f.manager.id,{action:"unit",facilityId:f.facility.id,version:original,value:"DEMO-02"}),/CHANGED/);
  await step("agreement","confirmed");await step("payment","100");await step("identity","confirmed");
  await assert.rejects(step("photo"),/SAMPLE_REQUIRED/);
  await validateTrainingSample(new File([new Uint8Array(await trainingSample())],"sample.png",{type:"image/png"}));
  const different=await sharp({create:{width:240,height:320,channels:3,background:"red"}}).png().toBuffer();
  await assert.rejects(validateTrainingSample(new File([new Uint8Array(different)],"different.png",{type:"image/png"})),/SAMPLE_REQUIRED/);
  await step("photo",undefined,true);await assert.rejects(step("approve"),/STEP_REQUIRED/);
  await step("preview");await step("reject");await step("photo",undefined,true);await step("preview");await step("approve");await step("handover","confirmed");
  assert.ok(snapshot.run!.state.handedOverAt);assert.equal((await trainingSnapshot(f.manager.id,f.facility.id)).run!.state.paid,100);
  assert.equal((await trainingSnapshot(f.owner.id,f.facility.id)).run,null);
  await assert.rejects(step("reset"),/FORBIDDEN/);
  assert.equal(await db.customer.count({where:{organisationId:f.org.id}}),0);
  assert.equal(await db.reservation.count({where:{facility:{organisationId:f.org.id}}}),0);
  assert.equal(await db.tenancy.count({where:{facility:{organisationId:f.org.id}}}),0);
  assert.equal(await db.payment.count({where:{account:{customer:{organisationId:f.org.id}}}}),0);
  assert.equal(await db.unit.count({where:{facility:{organisationId:f.org.id}}}),0);
  assert.equal(await db.auditEvent.count({where:{organisationId:f.org.id,action:"training.handover"}}),1);
 });
 await t.test("owner off invalidates open runs; re-enable cannot revive stale state",async()=>{
  const before=await trainingSnapshot(f.owner.id);const stale=(await trainingSnapshot(f.manager.id)).run!;
  await trainingCommand(f.owner.id,{action:"toggle",enabled:false,version:before.controlVersion});
  await assert.rejects(trainingCommand(f.manager.id,{action:"handover",facilityId:f.facility.id,version:stale.version,value:"confirmed"}),/DISABLED/);
  const off=await trainingSnapshot(f.owner.id);assert.equal(off.run,null);
  await trainingCommand(f.owner.id,{action:"toggle",enabled:true,version:off.controlVersion});
  await assert.rejects(trainingCommand(f.manager.id,{action:"handover",facilityId:f.facility.id,version:stale.version,value:"confirmed"}),/CHANGED/);
  const fresh=await trainingCommand(f.manager.id,{action:"start",facilityId:f.facility.id});assert.equal(fresh.run!.state.paid,0);
  await db.roleAssignment.deleteMany({where:{userId:f.manager.id}});
  await assert.rejects(trainingSnapshot(f.manager.id),/FORBIDDEN/);
  await assert.rejects(trainingCommand(f.manager.id,{action:"unit",facilityId:f.facility.id,version:fresh.run!.version,value:"DEMO-01"}),/FORBIDDEN/);
 });
 await t.test("only the controlling owner can toggle, even if another owner is added",async()=>{
  const role=await db.role.findFirstOrThrow({where:{organisationId:f.org.id,name:"Organisation owner"}});
  const second=await db.user.create({data:{organisationId:f.org.id,name:"Second CI owner",email:randomUUID()+"@example.invalid",roleAssignments:{create:{roleId:role.id}}}});
  const status=await trainingSnapshot(second.id);assert.equal(status.canToggle,false);
  await assert.rejects(trainingCommand(second.id,{action:"toggle",enabled:false,version:status.controlVersion}),/FORBIDDEN/);
  const owner=await trainingSnapshot(f.owner.id);
  await assert.rejects(trainingCommand(f.owner.id,{action:"toggle",enabled:false,version:owner.controlVersion-1}),/CHANGED/);
 });
 await t.test("inactive owner cannot use a previously valid session identity",async()=>{
  await db.user.update({where:{id:f.owner.id},data:{active:false}});
  await assert.rejects(trainingSnapshot(f.owner.id),/FORBIDDEN/);
  await db.user.update({where:{id:f.owner.id},data:{active:true}});
 });
 await t.test("another organisation cannot address a training facility",async()=>{
  const other=await fixture();await trainingCommand(other.owner.id,{action:"toggle",enabled:true,version:0});
  await assert.rejects(trainingCommand(other.owner.id,{action:"start",facilityId:f.facility.id}),/FORBIDDEN/);
 });
 }finally{await db.$disconnect();}
});

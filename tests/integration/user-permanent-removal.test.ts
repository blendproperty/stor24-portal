import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { db } from "../../src/lib/db";
import { hashResetToken } from "../../src/lib/password-reset";

test("permanent user deletion frees email while preserving linked business records", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key=randomUUID();
  const org=await db.organisation.create({data:{name:"Deletion synthetic",slug:key}});
  const other=await db.organisation.create({data:{name:"Foreign synthetic",slug:`${key}-foreign`}});
  const owner=await db.user.create({data:{organisationId:org.id,name:"Owner",email:`owner-${key}@example.invalid`,passwordHash:"synthetic"}});
  const target=await db.user.create({data:{organisationId:org.id,name:"Target",email:`target-${key}@example.invalid`,passwordHash:"synthetic"}});
  const foreign=await db.user.create({data:{organisationId:other.id,name:"Foreign",email:`foreign-${key}@example.invalid`,passwordHash:"synthetic"}});
  const ownerRole=await db.role.create({data:{organisationId:org.id,name:"Organisation owner",permissions:["*"]}});
  const staffRole=await db.role.create({data:{organisationId:org.id,name:"Staff",permissions:["users.manage"]}});
  await db.roleAssignment.create({data:{userId:owner.id,roleId:ownerRole.id}});
  await db.roleAssignment.create({data:{userId:target.id,roleId:staffRole.id}});
  const reset=await db.passwordResetToken.create({data:{userId:target.id,organisationId:org.id,tokenHash:hashResetToken(randomUUID()),expiresAt:new Date(Date.now()+60000)}});
  const oldInvite=await db.userInvitation.create({data:{organisationId:org.id,email:target.email,name:target.name,roleName:"Facility manager",invitedByName:"Synthetic owner",tokenHash:hashResetToken(randomUUID()),expiresAt:new Date(Date.now()+60000)}});
  const priorAudit=await db.auditEvent.create({data:{organisationId:org.id,actorId:target.id,action:"user.login.succeeded",entityType:"User",entityId:target.id}});
  let session: unknown=null;
  const out=await build({entryPoints:["src/app/api/v1/users/[id]/permanent-delete/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"fixture",setup(b){
    b.onResolve({filter:/^@\/(lib\/(db|session)|generated\/prisma\/client)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db")?"export const db=__db;":a.path.endsWith("/session")?"export const getSession=async()=>__session();":"import {sqltag,join} from '@prisma/client/runtime/client';export const Prisma={sql:sqltag,join};",resolveDir:process.cwd()}));
  }}]});
  const mod={exports:{} as {DELETE:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>}};
  new Function("require","module","exports","__db","__session",out.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports,db,()=>session);
  const call=(id:string,origin="https://example.invalid")=>mod.exports.DELETE(new Request("https://example.invalid/api",{method:"DELETE",headers:{origin}}),{params:Promise.resolve({id})});
  try {
    await t.test("denies anonymous, non-owner, stale, no MFA, cross-origin, foreign and own deletion",async()=>{
      assert.equal((await call(target.id)).status,401);
      session={userId:target.id,sessionVersion:target.sessionVersion,mfaVerified:true}; assert.equal((await call(owner.id)).status,403);
      session={userId:owner.id,sessionVersion:owner.sessionVersion,mfaVerified:false}; assert.equal((await call(target.id)).status,403);
      session={userId:owner.id,sessionVersion:owner.sessionVersion+1,mfaVerified:true}; assert.equal((await call(target.id)).status,401);
      session={userId:owner.id,sessionVersion:owner.sessionVersion,mfaVerified:true};
      assert.equal((await call(target.id,"https://attacker.invalid")).status,403);
      assert.equal((await call(foreign.id)).status,404); assert.equal((await call(owner.id)).status,409);
      assert.equal((await call(target.id)).status,409);
      await db.user.update({where:{id:target.id},data:{active:false,sessionVersion:{increment:1}}});
    });
    await t.test("linked records prevent deletion until reassigned",async()=>{
      const facility=await db.facility.create({data:{organisationId:org.id,code:"CI",name:"Synthetic facility"}});
      const lead=await db.lead.create({data:{facilityId:facility.id,source:"CI",assignedToId:target.id}});
      const response=await call(target.id);assert.equal(response.status,409);assert.match((await response.json()).error.message,/Lead/);
      assert.ok(await db.user.findUnique({where:{id:target.id}}));assert.equal((await db.lead.findUniqueOrThrow({where:{id:lead.id}})).assignedToId,target.id);
      await db.lead.update({where:{id:lead.id},data:{assignedToId:owner.id}});
      const training=await db.moveInTrainingRun.create({data:{organisationId:org.id,userId:target.id,facilityId:facility.id,generation:1,state:{}}});
      const legacy=await call(target.id);assert.equal(legacy.status,409);assert.match((await legacy.json()).error.message,/Move In Training Run/);
      await db.moveInTrainingRun.update({where:{id:training.id},data:{userId:owner.id}});
      const config=await db.configurationProfile.create({data:{organisationId:org.id,domain:"CI",name:key,config:{nested:{reviewerId:target.id}}}});
      const json=await call(target.id);assert.equal(json.status,409);assert.match((await json.json()).error.message,/Configuration Profile data/);
      await db.configurationProfile.update({where:{id:config.id},data:{config:{nested:{reviewerId:owner.id}}}});
      const businessAudit=await db.auditEvent.create({data:{organisationId:org.id,actorId:target.id,action:"netcash.debicheck_bank_consent_reviewed",entityType:"ConfigurationProfile",entityId:config.id}});
      const auditBlock=await call(target.id);assert.equal(auditBlock.status,409);assert.match((await auditBlock.json()).error.message,/Business audit event/);
      await db.auditEvent.update({where:{id:businessAudit.id},data:{actorId:owner.id}});
    });
    await t.test("audit failure rolls back; success removes account and credential, retains audit and frees the exact email",async()=>{
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_user_delete_audit_failure CHECK (false) NOT VALID');
      try{assert.equal((await call(target.id)).status,500);assert.ok(await db.user.findUnique({where:{id:target.id}}));assert.ok(await db.passwordResetToken.findUnique({where:{id:reset.id}}));assert.equal((await db.userInvitation.findUniqueOrThrow({where:{id:oldInvite.id}})).status,"PENDING");}
      finally{await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_user_delete_audit_failure');}
      assert.equal((await call(target.id)).status,200);
      assert.equal(await db.user.findUnique({where:{id:target.id}}),null);assert.equal(await db.passwordResetToken.findUnique({where:{id:reset.id}}),null);
      assert.equal((await db.auditEvent.findUniqueOrThrow({where:{id:priorAudit.id}})).actorId,null);
      assert.equal((await db.userInvitation.findUniqueOrThrow({where:{id:oldInvite.id}})).status,"REVOKED");
      assert.equal(await db.auditEvent.count({where:{entityId:target.id,action:"user.account.deleted"}}),1);
      const inviteBundle=await build({entryPoints:["src/app/api/v1/invitations/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"fixture",setup(b){
        b.onResolve({filter:/^@\/lib\/(db|session|email)$/},a=>({path:a.path,namespace:"fixture"}));
        b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db")?"export const db=__db;":a.path.endsWith("/session")?"export const getSession=async()=>__session();":"export const emailProvider=()=>({send:async()=>({})});"}));
      }}]});
      const invite={exports:{} as {POST:(r:Request)=>Promise<Response>}};
      new Function("require","module","exports","__db","__session",inviteBundle.outputFiles[0].text)(createRequire(import.meta.url),invite,invite.exports,db,()=>({...session as object,name:"Synthetic owner"}));
      const request=new Request("https://example.invalid/api/v1/invitations",{method:"POST",headers:{origin:"https://example.invalid","content-type":"application/json"},body:JSON.stringify({name:"New employee",email:target.email,roleName:"Facility manager"})});
      assert.equal((await invite.exports.POST(request)).status,201);
      assert.equal(await db.userInvitation.count({where:{organisationId:org.id,email:target.email,status:"PENDING"}}),1);
    });
  } finally {await db.$disconnect();}
});

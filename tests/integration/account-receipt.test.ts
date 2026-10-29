import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";

test("receipt copy uses real scoped ledger evidence and denies revoked, foreign, test and changed sources", {skip:process.env.MERCHANDISE_DB_TEST!=="isolated-ci"}, async()=>{
  assert.ok(["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const org=await db.organisation.create({data:{name:"Synthetic receipt viewing",slug:randomUUID()}});
  const state={db,Prisma,session:{ userId: "", sessionVersion: 0, mfaVerified: true }};
  const bundle=await build({entryPoints:["src/app/api/v1/accounts/[id]/receipts/[paymentId]/route.ts","src/app/api/v1/accounts/route.ts"],bundle:true,write:false,outdir:"fixture",platform:"node",format:"cjs",packages:"external",plugins:[{name:"real-db-no-provider",setup(b){
    b.onResolve({filter:/^@\/lib\/(db|session|dlp-transfer-service|whatsapp|hostinger-email)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db")?"export const db=__state.db;":a.path.endsWith("/session")?"export const getSession=async()=>__state.session;":a.path.endsWith("/hostinger-email")?"export class HostingerEmailProvider {}":a.path.endsWith("/whatsapp")?"export const sendWhatsAppTemplate=async()=>{throw Error('NO_SEND_IN_RECEIPT_READ_TEST')};":"export const guardDlpTransfer=async()=>({});export const protectDlpResponse=async r=>r;"}));
    b.onResolve({filter:/generated\/prisma\/client$/},()=>({path:"prisma",namespace:"prisma"}));
    b.onLoad({filter:/.*/,namespace:"prisma"},()=>({contents:"export const Prisma=__state.Prisma;"}));
  }}]});
  const handlers=bundle.outputFiles.map(file=>{const loaded={exports:{} as {GET:(r:Request,c:{params:Promise<{id:string;paymentId:string}>})=>Promise<Response>}};new Function("require","module","exports","__state",file.text)(createRequire(import.meta.url),loaded,loaded.exports,state);return {path:file.path,get:loaded.exports.GET};});
  const receipt=handlers.find(h=>h.path.includes("paymentId"))!.get;
  const accounts=handlers.find(h=>!h.path.includes("paymentId"))!.get;
  try{
    const store=await db.facility.create({data:{organisationId:org.id,name:"Synthetic store",code:randomUUID()}}),other=await db.facility.create({data:{organisationId:org.id,name:"Excluded store",code:randomUUID()}});
    const role=await db.role.create({data:{organisationId:org.id,name:"Synthetic ledger reader",permissions:["ledger.view"]}});
    const user=await db.user.create({data:{ passwordHash: "synthetic-not-a-real-password-hash",organisationId:org.id,name:"Synthetic reader",email:randomUUID()+"@example.invalid",roleAssignments:{create:{roleId:role.id,facilityId:store.id}}}});state.session={ userId: user.id, sessionVersion: user.sessionVersion, mfaVerified: true };
    async function fixture(facilityId=store.id){
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic <customer>"}});
      const account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID(),balance:60}});
      await db.tenancy.create({data:{customerId:customer.id,accountId:account.id,facilityId,startDate:new Date("2026-01-01"),status:"ACTIVE"}});
      await db.ledgerEntry.create({data:{accountId:account.id,type:"CHARGE",amount:100,description:"Synthetic charge",effectiveAt:new Date("2026-01-01")}});
      const payment=await db.payment.create({data:{accountId:account.id,status:"SUCCEEDED",amount:40,method:"EFT",processedAt:new Date("2026-01-02"),idempotencyKey:randomUUID()}});
      const entry=await db.ledgerEntry.create({data:{accountId:account.id,type:"PAYMENT",amount:40,description:"Synthetic receipt",effectiveAt:new Date("2026-01-02"),externalRef:payment.idempotencyKey}});
      await db.auditEvent.create({data:{organisationId:org.id,facilityId,actorId:user.id,entityType:"Payment",entityId:payment.id,action:"payment.posted",after:{accountId:account.id,ledgerEntryId:entry.id}}});
      const get=(id=account.id)=>receipt(new Request("https://example.invalid/receipt"),{params:Promise.resolve({id,paymentId:payment.id})});
      return {account,payment,entry,get};
    }
    const f=await fixture(),foreign=await fixture(other.id),another=await fixture();
    const before=await Promise.all([db.ledgerEntry.count({where:{accountId:f.account.id}}),db.payment.count({where:{accountId:f.account.id}}),db.communicationLog.count({where:{organisationId:org.id}})]);
    const response=await f.get();assert.equal(response.status,200);assert.match(await response.text(),/Synthetic &lt;customer&gt;/);
    assert.equal((await f.get(another.account.id)).status,404);assert.equal((await foreign.get()).status,404);
    const selected=await accounts(new Request(`https://example.invalid/api/v1/accounts?accountId=${f.account.id}`),{params:Promise.resolve({id:"",paymentId:""})});assert.equal(selected.status,200);assert.deepEqual((await selected.json()).data.accounts.map((a:{id:string})=>a.id),[f.account.id]);
    await db.payment.update({where:{id:f.payment.id},data:{environment:"sandbox"}});assert.equal((await f.get()).status,409);await db.payment.update({where:{id:f.payment.id},data:{environment:null}});
    await db.account.update({where:{id:f.account.id},data:{balance:59}});assert.equal((await f.get()).status,409);await db.account.update({where:{id:f.account.id},data:{balance:60}});
    await db.role.update({where:{id:role.id},data:{permissions:[]}});assert.equal((await f.get()).status,403);
    assert.deepEqual(await Promise.all([db.ledgerEntry.count({where:{accountId:f.account.id}}),db.payment.count({where:{accountId:f.account.id}}),db.communicationLog.count({where:{organisationId:org.id}})]),before);
  }finally{
    await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.ledgerEntry.deleteMany({where:{account:{customer:{organisationId:org.id}}}});await db.payment.deleteMany({where:{account:{customer:{organisationId:org.id}}}});await db.tenancy.deleteMany({where:{facility:{organisationId:org.id}}});await db.account.deleteMany({where:{customer:{organisationId:org.id}}});await db.customer.deleteMany({where:{organisationId:org.id}});await db.roleAssignment.deleteMany({where:{user:{organisationId:org.id}}});await db.user.deleteMany({where:{organisationId:org.id}});await db.role.deleteMany({where:{organisationId:org.id}});await db.facility.deleteMany({where:{organisationId:org.id}});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
  }
});

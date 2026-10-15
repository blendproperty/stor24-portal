import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";

test("isolated receipt reallocation table guards retain original evidence and reject incomplete posting",async()=>{
  const url=new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.ok(["localhost","127.0.0.1"].includes(url.hostname));assert.match(url.pathname,/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/);
  const org=await db.organisation.create({data:{name:"Synthetic receipt table guards",slug:randomUUID()}});
  try{
    const facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic receipt store",code:randomUUID()}});
    const requester=await db.user.create({data:{organisationId:org.id,name:"Synthetic proposer",email:randomUUID()+"@example.invalid"}}),reviewer=await db.user.create({data:{organisationId:org.id,name:"Synthetic reviewer",email:randomUUID()+"@example.invalid"}});
    const first=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic source"}}),second=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic target"}});
    const source=await db.account.create({data:{customerId:first.id,accountNumber:randomUUID(),balance:-200}}),target=await db.account.create({data:{customerId:second.id,accountNumber:randomUUID(),balance:450}});
    const sourceTenancy=await db.tenancy.create({data:{customerId:first.id,accountId:source.id,facilityId:facility.id,startDate:new Date(),status:"ACTIVE"}}),targetTenancy=await db.tenancy.create({data:{customerId:second.id,accountId:target.id,facilityId:facility.id,startDate:new Date(),status:"ACTIVE"}});
    const payment=await db.payment.create({data:{accountId:source.id,status:"SUCCEEDED",amount:200,method:"EFT",provider:"NETCASH",environment:"live",idempotencyKey:randomUUID()}});
    const original=await db.ledgerEntry.create({data:{accountId:source.id,type:"PAYMENT",amount:200,description:"Synthetic original receipt",effectiveAt:new Date(),externalRef:"synthetic-original-"+payment.id,metadata:{paymentId:payment.id,verifiedStatus:true,environment:"live"}}});
    await db.ledgerEntry.create({data:{accountId:target.id,type:"CHARGE",amount:450,description:"Synthetic original charge",effectiveAt:new Date()}});
    const data={organisationId:org.id,facilityId:facility.id,sourceAccountId:source.id,targetAccountId:target.id,sourceEntryId:original.id,paymentId:payment.id,requestKey:randomUUID(),requestHash:"a".repeat(64),amount:"75.25",reason:"Synthetic retained correction request",evidenceReference:"Synthetic source evidence",snapshot:{schemaFixtureOnly:true},fingerprint:"b".repeat(64),requestedById:requester.id};
    const before=await Promise.all([db.account.findMany({where:{id:{in:[source.id,target.id]}},orderBy:{id:"asc"}}),db.payment.findUniqueOrThrow({where:{id:payment.id}}),db.ledgerEntry.findMany({where:{accountId:{in:[source.id,target.id]}},orderBy:{id:"asc"}})]);
    await assert.rejects(db.receiptReallocation.create({data:{...data,sourceAccountId:target.id}}));
    await assert.rejects(db.receiptReallocation.create({data:{...data,amount:0}}));
    await assert.rejects(db.receiptReallocation.create({data:{...data,paymentId:"missing-root-payment"}}));
    const request=await db.receiptReallocation.create({data});
    await assert.rejects(db.receiptReallocation.create({data:{...data,requestKey:randomUUID()}}));
    await assert.rejects(db.receiptReallocation.update({where:{id:request.id},data:{amount:1,revision:1,status:"CANCELLED"}}));
    await assert.rejects(db.receiptReallocation.update({where:{id:request.id},data:{revision:1}}));
    await assert.rejects(db.receiptReallocation.update({where:{id:request.id},data:{status:"REJECTED",revision:1,reviewedById:requester.id,reviewedAt:new Date(),reviewReference:"Synthetic invalid self review"}}));
    // A null posting actor must fail even with every other required field set.
    // SQL CHECK(NULL) would otherwise accept this incomplete terminal evidence.
    const postingChecks=await db.$queryRaw<{conname:string}[]>`SELECT conname FROM pg_constraint WHERE conrelid='"ReceiptReallocation"'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%"postedById" IS NOT NULL%'`;assert.equal(postingChecks.length,1);
    await assert.rejects(db.$transaction(async tx=>{
      const outgoing=await tx.ledgerEntry.create({data:{accountId:source.id,type:"REVERSAL",reversalOfId:original.id,amount:"75.25",description:"Synthetic rollback probe",effectiveAt:new Date()}}),incoming=await tx.ledgerEntry.create({data:{accountId:target.id,type:"PAYMENT",amount:"75.25",description:"Synthetic rollback probe",effectiveAt:new Date()}});
      const firstDoc=await tx.document.create({data:{tenancyId:sourceTenancy.id,type:"ADJUSTMENT",storageKey:"inline:synthetic-schema-probe",content:"Synthetic schema guard only"}}),secondDoc=await tx.document.create({data:{tenancyId:targetTenancy.id,type:"ADJUSTMENT",storageKey:"inline:synthetic-schema-probe",content:"Synthetic schema guard only"}});
      await tx.receiptReallocation.update({where:{id:request.id},data:{status:"POSTED",revision:1,reviewedById:reviewer.id,reviewReference:"Synthetic independent review",reviewedAt:new Date(),postedAt:new Date(),postedById:null,sourceLedgerEntryId:outgoing.id,targetLedgerEntryId:incoming.id,sourceDocumentId:firstDoc.id,targetDocumentId:secondDoc.id}});
    }),error=>error instanceof Error&&error.message.includes(postingChecks[0].conname));
    await db.receiptReallocation.update({where:{id:request.id},data:{status:"REJECTED",revision:1,reviewedById:reviewer.id,reviewedAt:new Date(),reviewReference:"Synthetic independent rejection"}});
    await assert.rejects(db.receiptReallocation.update({where:{id:request.id},data:{reviewReference:"Altered terminal history",revision:2}}));
    assert.deepEqual(await Promise.all([db.account.findMany({where:{id:{in:[source.id,target.id]}},orderBy:{id:"asc"}}),db.payment.findUniqueOrThrow({where:{id:payment.id}}),db.ledgerEntry.findMany({where:{accountId:{in:[source.id,target.id]}},orderBy:{id:"asc"}})]),before);
  }finally{
    await db.receiptReallocation.deleteMany({where:{organisationId:org.id}});
    const accounts={customer:{organisationId:org.id}};
    await db.document.deleteMany({where:{tenancy:{facility:{organisationId:org.id}}}});await db.ledgerEntry.deleteMany({where:{account:accounts}});await db.payment.deleteMany({where:{account:accounts}});await db.tenancy.deleteMany({where:{facility:{organisationId:org.id}}});await db.account.deleteMany({where:accounts});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
  }
});

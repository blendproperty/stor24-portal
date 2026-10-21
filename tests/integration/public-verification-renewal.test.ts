import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {preparePublicVerificationCode} from "../../src/lib/public-verification-renewal";

test("expired code renewal atomically reclaims only available expired holds and resets each challenge",async()=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"localhost");assert.match(url.pathname,/_ci$/);
 const key=randomUUID(),org=await db.organisation.create({data:{name:"Renewal CI",slug:key}});
 const facility=await db.facility.create({data:{organisationId:org.id,name:"CI",code:key}});
 const type=await db.unitType.create({data:{facilityId:facility.id,name:"CI"}});
 const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"CI",monthlyRate:100,status:"AVAILABLE"}});
 const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic",email:"fixture@example.invalid"}});
 const past=new Date(Date.now()-60_000),future=new Date(Date.now()+86400_000);
 const reservation=await db.reservation.create({data:{facilityId:facility.id,unitId:unit.id,customerId:customer.id,publicReference:key,idempotencyKey:key,status:"CANCELLED",source:"PUBLIC_WEBSITE",quotedRate:100,holdExpiresAt:past,intendedMoveIn:future,verificationExpiresAt:past,verificationCodeHash:"old",verificationAttempts:5}});
 const expiredAudit=()=>db.auditEvent.create({data:{organisationId:org.id,facilityId:facility.id,entityType:"Reservation",entityId:reservation.id,action:"public_reservation.hold_expired"}});
 const issue=(channel:"MOBILE"|"EMAIL"="MOBILE",bookingKey:string|undefined=key,hash="fresh")=>preparePublicVerificationCode({id:reservation.id,channel,bookingKey,hash});
 try{
  await expiredAudit();
  assert.equal((await issue("MOBILE",randomUUID())).ok,false);
  assert.equal((await db.reservation.findUniqueOrThrow({where:{id:reservation.id}})).verificationCodeHash,"old");
  assert.equal((await issue()).ok,true);
  let row=await db.reservation.findUniqueOrThrow({where:{id:reservation.id}});
  assert.equal(row.status,"ACTIVE");assert.equal(row.verificationAttempts,0);assert.equal(row.verificationCodeHash,"fresh");assert.ok(row.verificationExpiresAt!>new Date());
  assert.equal((await db.unit.findUniqueOrThrow({where:{id:unit.id}})).status,"RESERVED");
  assert.equal((await issue("MOBILE",undefined,"newest")).ok,true);
  row=await db.reservation.findUniqueOrThrow({where:{id:reservation.id}});assert.equal(row.verificationCodeHash,"newest");
  const hold=row.holdExpiresAt!;
  await db.reservation.update({where:{id:row.id},data:{contactVerifiedAt:new Date(),verificationAttempts:10,verificationExpiresAt:past}});
  assert.equal((await issue("EMAIL",undefined,"email-fresh")).ok,true);
  row=await db.reservation.findUniqueOrThrow({where:{id:row.id}});assert.equal(row.verificationAttempts,0);assert.equal(row.holdExpiresAt!.getTime(),hold.getTime());assert.equal(row.verificationCodeHash,"email-fresh");
  await db.reservation.update({where:{id:row.id},data:{contactVerifiedAt:null,status:"CANCELLED",holdExpiresAt:past}});
  await db.auditEvent.create({data:{organisationId:org.id,entityType:"Reservation",entityId:row.id,action:"reservation.cancelled"}});
  assert.equal((await issue()).ok,false,"staff cancellation cannot be undone by resend");
  await expiredAudit();await db.unit.update({where:{id:unit.id},data:{status:"OCCUPIED"}});
  assert.equal((await issue()).ok,false,"another occupancy is never stolen");
  await db.unit.update({where:{id:unit.id},data:{status:"AVAILABLE"}});
  const other=await db.reservation.create({data:{facilityId:facility.id,unitId:unit.id,customerId:customer.id,status:"ACTIVE",quotedRate:100}});
  assert.equal((await issue()).ok,false,"another booking is never stolen");await db.reservation.delete({where:{id:other.id}});
  const products=await Promise.all([db.product.create({data:{id:`a-${key}`,organisationId:org.id,facilityId:facility.id,sku:`a-${key}`,name:"Synthetic A",sellingPrice:15,quantityOnHand:10}}),db.product.create({data:{id:`b-${key}`,organisationId:org.id,facilityId:facility.id,sku:`b-${key}`,name:"Synthetic B",sellingPrice:20,quantityOnHand:0}})]);
  const pack=await db.reservationPackage.create({data:{reservationId:reservation.id,status:"RELEASED",packageCode:"SYNTHETIC",packageName:"Synthetic",priceSnapshot:35,itemsSnapshot:products.map(p=>({productId:p.id,quantity:1,unitPriceZar:Number(p.sellingPrice)}))}});
  assert.equal((await issue()).ok,false,"insufficient package stock must reject the entire renewal");
  assert.equal((await db.product.findUniqueOrThrow({where:{id:products[0].id}})).quantityReserved,0,"earlier stock claims roll back atomically");
  assert.equal((await db.reservation.findUniqueOrThrow({where:{id:reservation.id}})).status,"CANCELLED");
  await db.reservationPackage.delete({where:{id:pack.id}});
  const competitor=await db.reservation.create({data:{facilityId:facility.id,unitId:unit.id,customerId:customer.id,status:"CANCELLED",source:"PUBLIC_WEBSITE",quotedRate:100,idempotencyKey:randomUUID(),holdExpiresAt:past,intendedMoveIn:future}});
  await db.auditEvent.create({data:{organisationId:org.id,entityType:"Reservation",entityId:competitor.id,action:"public_reservation.hold_expired"}});
  const results=await Promise.all([issue(),preparePublicVerificationCode({id:competitor.id,channel:"MOBILE",bookingKey:competitor.idempotencyKey!,hash:"competitor"})]);
  assert.equal(results.filter(r=>r.ok).length,1,"only one concurrent expired hold can reclaim the unit");
  assert.equal(await db.reservation.count({where:{unitId:unit.id,status:"ACTIVE"}}),1);
  assert.equal(await db.publicPaymentSession.count({where:{reservationId:reservation.id}}),0);
 }finally{
  await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.reservation.deleteMany({where:{facilityId:facility.id}});await db.customer.deleteMany({where:{organisationId:org.id}});await db.unit.delete({where:{id:unit.id}});await db.unitType.delete({where:{id:type.id}});await db.product.deleteMany({where:{facilityId:facility.id}});await db.facility.delete({where:{id:facility.id}});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
 }
});

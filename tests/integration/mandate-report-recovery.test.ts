import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {newPublicInitialRent} from "../../src/lib/public-initial-rent";
import {encryptIntegrationSecret} from "../../src/lib/integrations/integration-secret-vault";
import {debitConnectionFingerprint} from "../../src/lib/payments/netcash-debit-batch";
import {refreshHostedMandate,startHostedMandate} from "../../src/lib/public-hosted-mandate";
test("isolated report recovery restores one existing authority without creation or financial writes",async()=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
 process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="mandate-recovery-ci-only-encryption-key-32";
 const key=randomUUID(),serviceKey=randomUUID(),year=new Date().getUTCFullYear();
 const moveIn=new Date(`${year}-01-01T12:00:00Z`);
 // Existing authority remains recheckable after its first collection date passes.
 const firstDate=`${year}-12-01`;const month=12;const agreementDate=`${year}0101`;
 const org=await db.organisation.create({data:{name:"Recovery CI",slug:key}});
 const facility=await db.facility.create({data:{organisationId:org.id,name:"CI store",code:key}});
 const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic",lastName:"CI"}});
 const type=await db.unitType.create({data:{facilityId:facility.id,name:"CI",features:[]}});
 const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"CI",monthlyRate:950}});
 const reservation=await db.reservation.create({data:{facilityId:facility.id,customerId:customer.id,unitId:unit.id,publicReference:`ST24-${key}`,quotedRate:950,intendedMoveIn:moveIn,initialRentSnapshot:newPublicInitialRent(950,moveIn)}});
 const lease=await db.publicReservationLease.create({data:{reservationId:reservation.id,version:"CI",paymentMethod:"DEBIT_ORDER",content:"CI",clauses:[],sha256:"a".repeat(64),signingToken:key,expiresAt:new Date("2099-01-01"),status:"SIGNED",signedAt:moveIn,debitOrderPreferences:{firstCollectionDate:firstDate,collectionDay:1}}});
 process.env.NETCASH_MANDATE_SETUP_ENABLED="true";process.env.NETCASH_MANDATE_POLICY=JSON.stringify({organisationId:org.id,approvedBy:"CI-only",noticeDays:30,holiday:"VeryNextOrdinaryBusinessDay",allowedDays:[1],recurringAmountBasis:"SIGNED_MONTHLY_RENT_ONLY",firstPaymentHandling:"SEPARATE_APPROVED_PAYMENT",postbackConfigured:true});
 const config={environment:"test",merchantAccountEncrypted:encryptIntegrationSecret("51111111111"),debitOrderServiceKeyEncrypted:encryptIntegrationSecret(serviceKey),transactionProcessingEnabled:true};
 const connection=await db.integrationConnection.create({data:{organisationId:org.id,category:"PAYMENTS",provider:"NETCASH",config}});
 const terms={reference:`CI${key.replaceAll("-","").slice(0,18)}`,agreementReference:reservation.publicReference!,agreementDate,amount:"950.00",commencementMonth:month,debitDay:1,noticeDays:30,holiday:"VeryNextOrdinaryBusinessDay",correlation:key};
 const mandate=await db.publicDebitMandate.create({data:{leaseId:lease.id,reference:terms.reference,correlation:key,terms,status:"REVIEW_REQUIRED",hostedUrl:"https://short.surf/synthetic",environment:"sandbox",connectionId:connection.id,connectionFingerprint:debitConnectionFingerprint({environment:"sandbox",merchantAccount:"51111111111",debitOrderServiceKey:serviceKey})}});
 let altered=false,empty=false;const methods:string[]=[];
 const network=mock.method(globalThis,"fetch",async(_url:unknown,options?:RequestInit)=>{
  const action=String((options?.headers as Record<string,string>).SOAPAction);methods.push(action);
  if(action.includes("RequestMandateData"))return new Response("<RequestMandateDataResult>20000000.123.1.1</RequestMandateDataResult>");
  assert.ok(action.includes("RetrieveMandateData"));if(empty)return new Response(`<RetrieveMandateDataResult>###BEGIN\t${agreementDate}\n###END</RetrieveMandateDataResult>`);const r=Array<string>(44).fill("");Object.assign(r,{0:"2",1:terms.reference,3:altered?"999.00":"950.0000",11:"1",12:firstDate.replaceAll("-",""),13:"01",14:agreementDate,15:terms.agreementReference,16:"30",17:"2",21:"0",30:key,40:"0"});
  return new Response(`<RetrieveMandateDataResult>###BEGIN\t${agreementDate}\n${r.join("\t")}\n###END</RetrieveMandateDataResult>`);
 });
 try{
  assert.equal((await refreshHostedMandate(key)).verificationPending,true);
  await db.publicDebitMandate.update({where:{id:mandate.id},data:{lastCheckedAt:null}});
  const recovered=await refreshHostedMandate(key);assert.equal(recovered.status,"AWAITING_SIGNATURE");assert.equal(recovered.hostedUrl,"https://short.surf/synthetic");assert.equal(recovered.collectionEnabled,false);
  const resumed=await startHostedMandate(key);assert.equal(resumed.reference,mandate.reference);
  assert.equal(await db.publicDebitMandate.count({where:{leaseId:lease.id}}),1);
  assert.equal((await db.publicDebitMandate.findUniqueOrThrow({where:{id:mandate.id}})).verifiedAt,null);
  empty=true;await db.publicDebitMandate.update({where:{id:mandate.id},data:{status:"REVIEW_REQUIRED",failureCode:null,lastCheckedAt:null,reportToken:"20000000.123.1.1",reportRequestedAt:new Date()}});
  const missing=await refreshHostedMandate(key);assert.equal(missing.status,"REVIEW_REQUIRED");assert.equal(missing.hostedUrl,null);empty=false;
  altered=true;await db.publicDebitMandate.update({where:{id:mandate.id},data:{status:"REVIEW_REQUIRED",failureCode:null,lastCheckedAt:null,reportToken:"20000000.123.1.1",reportRequestedAt:new Date()}});
  const blocked=await refreshHostedMandate(key);assert.equal(blocked.status,"REVIEW_REQUIRED");assert.equal(blocked.hostedUrl,null);assert.equal(blocked.failureCode,"MANDATE_REPORT_AMOUNT_MISMATCH");
  assert.equal(methods.filter(x=>x.includes("AddMandate")).length,0);
  assert.equal(await db.ledgerEntry.count({where:{account:{customerId:customer.id}}}),0);assert.equal(await db.payment.count({where:{account:{customerId:customer.id}}}),0);assert.equal(await db.debitOrderRun.count({where:{organisationId:org.id}}),0);
 }finally{network.mock.restore();await db.$disconnect();}
});

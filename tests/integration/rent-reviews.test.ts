import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { approveRentReview,previewRentReview,rentReviewReport,rentRatesForBilling,changeRentReviewState } from '../../src/lib/rent-review-service';
import { southAfricaDateKey } from '../../src/lib/south-africa-time';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {Prisma} from '../../src/generated/prisma/client';
test('isolated rent reviews preserve historical rates, enforce scope and prevent stale or repeated approvals',async()=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
  const key=randomUUID();const org=await db.organisation.create({data:{name:'Rent review CI',slug:key}});
  try{const facility=await db.facility.create({data:{organisationId:org.id,code:key,name:'CI store'}});const actor=await db.user.create({data:{organisationId:org.id,email:key+'@example.invalid',name:'CI owner'}});const customer=await db.customer.create({data:{organisationId:org.id,firstName:'CI'}});const unitType=await db.unitType.create({data:{facilityId:facility.id,name:'CI',features:[]}});const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:unitType.id,number:'101',monthlyRate:1000,status:'OCCUPIED'}});const account=await db.account.create({data:{customerId:customer.id,accountNumber:key}});const tenancy=await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,status:'ACTIVE',startDate:new Date('2020-01-01T00:00:00+02:00')}});const occupancy=await db.occupancy.create({data:{tenancyId:tenancy.id,unitId:unit.id,status:'ACTIVE',monthlyRate:1000,startDate:new Date('2020-01-01T00:00:00+02:00')}});
    const today=southAfricaDateKey(new Date());const future=String(Number(today.slice(0,4))+1)+'-12';const input={facilityId:facility.id,minimumMonths:12,basis:'TIME_IN_UNIT',type:'PERCENTAGE',value:5,effectivePeriod:future,selectedOccupancyIds:[occupancy.id]};
    await assert.rejects(rentReviewReport('another-org',facility.id),/FORBIDDEN/);const unknown=await previewRentReview(org.id,{...input,basis:'TIME_SINCE_CHANGE'});assert.equal(unknown.eligibleCount,0);assert.equal(unknown.rows[0].lastPriceChange,null);
    const before=await previewRentReview(org.id,input);assert.equal(before.eligibleCount,1);assert.equal(before.rows[0].newRate,1050);assert.equal(await db.configurationProfile.count({where:{organisationId:org.id,domain:'OCCUPANCY_RENT_SCHEDULE'}}),0);
    await db.occupancy.update({where:{id:occupancy.id},data:{monthlyRate:1100}});await assert.rejects(approveRentReview(org.id,actor.id,input,before.fingerprint,'CI approval'),/PREVIEW_CHANGED/);
    const zeroUnit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:unitType.id,number:'ZERO',monthlyRate:0,status:'OCCUPIED'}});await db.occupancy.create({data:{tenancyId:tenancy.id,unitId:zeroUnit.id,status:'ACTIVE',monthlyRate:0,startDate:new Date('2020-01-01T00:00:00+02:00')}});const fresh=await previewRentReview(org.id,input);assert.equal(fresh.eligibleCount,1);assert.ok(fresh.rows.find(r=>r.unit==='ZERO')?.reason);const attempts=await Promise.allSettled([approveRentReview(org.id,actor.id,input,fresh.fingerprint,'CI approval'),approveRentReview(org.id,actor.id,input,fresh.fingerprint,'CI approval')]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:'rent.group_increase.approved'}}),1);const o=await db.occupancy.findUniqueOrThrow({where:{id:occupancy.id}});assert.equal(Number(o.monthlyRate),1100);const old=await rentRatesForBilling(db,org.id,facility.id,[o],today.slice(0,7));assert.equal(old.get(o.id),1100);const next=await rentRatesForBilling(db,org.id,facility.id,[o],future);assert.equal(next.get(o.id),1155);
    await assert.rejects(approveRentReview(org.id,actor.id,input,fresh.fingerprint,'CI approval'),/PREVIEW_CHANGED/);assert.equal(await db.ledgerEntry.count({where:{accountId:account.id}}),0);assert.equal(await db.payment.count({where:{accountId:account.id}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);
  }finally{await db.$disconnect();}
});

test('size benchmarks, explicit selection and audited dismiss/restore remain separate from billing',async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
  const key=randomUUID(),org=await db.organisation.create({data:{name:'Synthetic extended rent review',slug:key}});
  let auditConstraint=false;
  try{
    const facility=await db.facility.create({data:{organisationId:org.id,name:'Synthetic store',code:key}}),other=await db.facility.create({data:{organisationId:org.id,name:'Excluded store',code:randomUUID()}}),actor=await db.user.create({data:{organisationId:org.id,name:'Synthetic owner',email:key+'@example.invalid'}});
    const type=await db.unitType.create({data:{facilityId:facility.id,name:'Size 5',areaSqMetres:5}}),sameSize=await db.unitType.create({data:{facilityId:facility.id,name:'Different type same size',areaSqMetres:5}}),unknown=await db.unitType.create({data:{facilityId:facility.id,name:'Unrecorded area'}}),otherType=await db.unitType.create({data:{facilityId:other.id,name:'Excluded size 5',areaSqMetres:5}});
    const customer=await db.customer.create({data:{organisationId:org.id,firstName:'Synthetic review'}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:key}}),tenancy=await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,status:'ACTIVE',startDate:new Date('2020-01-01')}});
    const unitA=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:'A',monthlyRate:1200,status:'OCCUPIED'}}),unitB=await db.unit.create({data:{facilityId:facility.id,unitTypeId:sameSize.id,number:'B',monthlyRate:1000,status:'OCCUPIED'}});
    const a=await db.occupancy.create({data:{tenancyId:tenancy.id,unitId:unitA.id,status:'ACTIVE',monthlyRate:1000,startDate:new Date('2020-01-01')}}),b=await db.occupancy.create({data:{tenancyId:tenancy.id,unitId:unitB.id,status:'ACTIVE',monthlyRate:1000,startDate:new Date('2020-01-01')}});
    await db.unit.createMany({data:[{facilityId:facility.id,unitTypeId:type.id,number:'SERVICE',monthlyRate:1000,status:'SERVICE'},{facilityId:facility.id,unitTypeId:type.id,number:'COMPONENT',monthlyRate:1000,status:'UNAVAILABLE',combinedIntoUnitId:unitA.id},{facilityId:other.id,unitTypeId:otherType.id,number:'EXCLUDED',monthlyRate:1000,status:'OCCUPIED'}]});
    const unrecorded=await db.unit.create({data:{facilityId:facility.id,unitTypeId:unknown.id,number:'UNKNOWN',monthlyRate:0,status:'OCCUPIED'}});
    await db.occupancy.create({data:{tenancyId:tenancy.id,unitId:unrecorded.id,status:'ACTIVE',monthlyRate:500,startDate:new Date('2020-01-01')}});
    const effectivePeriod=String(new Date().getUTCFullYear()+1)+'-12',base={facilityId:facility.id,minimumMonths:12,basis:'TIME_IN_UNIT',type:'PERCENTAGE',value:5,effectivePeriod},selected={...base,selectedOccupancyIds:[a.id]};
    await t.test('same-area types share current standalone-unit occupancy; absent size and zero standard stay unknown',async()=>{
      const report=await rentReviewReport(org.id,facility.id),row=report.rows.find(r=>r.id===a.id)!;
      assert.equal(row.areaSqMetres,5);assert.equal(row.standardRate,1200);assert.equal(row.varianceAmount,-200);assert.equal(row.variancePercent,-16.67);assert.equal(row.sizeOccupiedCount,2);assert.equal(row.sizeUnitCount,3);assert.equal(row.sizeOccupancyPercent,66.67);assert.equal(row.reviewStatus,'PENDING');assert.equal(row.lastPriceChange,null);
      const unknownRow=report.rows.find(r=>r.unit==='UNKNOWN')!;assert.equal(unknownRow.areaSqMetres,null);assert.equal(unknownRow.sizeOccupancyPercent,null);assert.equal(unknownRow.variancePercent,null);
    });
    await t.test('no implicit audience; unknown selections and partial invalid audiences cannot approve',async()=>{
      const empty=await previewRentReview(org.id,base);assert.equal(empty.selectedCount,0);await assert.rejects(approveRentReview(org.id,actor.id,base,empty.fingerprint,'Synthetic notice approval'),/SELECT_OCCUPANCIES/);
      await assert.rejects(previewRentReview(org.id,{...base,selectedOccupancyIds:['foreign-occupancy']}),/SELECTION_INVALID/);
      const ineligible={...selected,basis:'TIME_SINCE_CHANGE'},preview=await previewRentReview(org.id,ineligible);await assert.rejects(approveRentReview(org.id,actor.id,ineligible,preview.fingerprint,'Synthetic notice approval'),/SELECTION_REQUIRES_REVIEW/);
    });
    await t.test('dismiss and restore persist with reason, conflict detection and preview invalidation',async()=>{
      const preview=await previewRentReview(org.id,selected);
      const state={facilityId:facility.id,occupancyId:a.id,status:'DISMISSED',reason:'Synthetic exception for manager review',expectedUpdatedAt:null};
      await assert.rejects(changeRentReviewState('different-org',actor.id,state),/FORBIDDEN/);
      await assert.rejects(changeRentReviewState(org.id,actor.id,{...state,facilityId:other.id}),/SELECTION_INVALID/);
      await changeRentReviewState(org.id,actor.id,state);
      await assert.rejects(changeRentReviewState(org.id,actor.id,state),/REVIEW_CHANGED/);
      await assert.rejects(approveRentReview(org.id,actor.id,selected,preview.fingerprint,'Synthetic notice approval'),/PREVIEW_CHANGED/);
      const report=await rentReviewReport(org.id,facility.id),row=report.rows.find(r=>r.id===a.id)!;assert.equal(row.reviewStatus,'DISMISSED');assert.equal(row.reviewReason,state.reason);
      const dismissed=await previewRentReview(org.id,selected);assert.equal(dismissed.rows.find(r=>r.id===a.id)!.eligible,false);await assert.rejects(approveRentReview(org.id,actor.id,selected,dismissed.fingerprint,'Synthetic notice approval'),/SELECTION_REQUIRES_REVIEW/);
      await changeRentReviewState(org.id,actor.id,{...state,status:'PENDING',reason:'Synthetic exception resolved for review',expectedUpdatedAt:row.reviewUpdatedAt});
      assert.equal((await rentReviewReport(org.id,facility.id)).rows.find(r=>r.id===a.id)!.reviewStatus,'PENDING');assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:'rent.review.status_changed'}}),2);
    });
    await t.test('benchmark inventory drift invalidates approval; only explicitly selected rent is scheduled',async()=>{
      const before=await previewRentReview(org.id,selected);await db.unit.update({where:{id:unitA.id},data:{monthlyRate:1250}});await assert.rejects(approveRentReview(org.id,actor.id,selected,before.fingerprint,'Synthetic notice approval'),/PREVIEW_CHANGED/);
      const preview=await previewRentReview(org.id,selected);assert.equal(preview.selectedCount,1);assert.equal((await approveRentReview(org.id,actor.id,selected,preview.fingerprint,'Synthetic notice approval')).approvedCount,1);
      assert.equal(await db.configurationProfile.count({where:{organisationId:org.id,domain:'OCCUPANCY_RENT_SCHEDULE',name:b.id}}),0);assert.equal(await db.configurationProfile.count({where:{organisationId:org.id,domain:'OCCUPANCY_RENT_SCHEDULE',name:a.id}}),1);
      const rates=await rentRatesForBilling(db,org.id,facility.id,await db.occupancy.findMany({where:{id:{in:[a.id,b.id]}}}),effectivePeriod);assert.equal(rates.get(a.id),1050);assert.equal(rates.get(b.id),1000);
      const audit=await db.auditEvent.findFirstOrThrow({where:{organisationId:org.id,action:'rent.group_increase.approved'}});assert.equal((audit.after as {changes:unknown[]}).changes.length,1);
    });
    await t.test('failed audit rolls back review state; no financial or messaging records are produced',async()=>{
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_rent_review_audit_failure CHECK ("organisationId" <> '${org.id}' OR action <> 'rent.review.status_changed') NOT VALID`);auditConstraint=true;
      await assert.rejects(changeRentReviewState(org.id,actor.id,{facilityId:facility.id,occupancyId:b.id,status:'DISMISSED',reason:'Synthetic rollback evidence',expectedUpdatedAt:null}));
      assert.equal(await db.configurationProfile.count({where:{organisationId:org.id,domain:'OCCUPANCY_RENT_REVIEW',name:b.id}}),0);
      assert.equal(await db.ledgerEntry.count({where:{accountId:account.id}}),0);assert.equal(await db.payment.count({where:{accountId:account.id}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);
    });
    await t.test('actual routes enforce origin, session, MFA, current owner and validation against PostgreSQL',async()=>{
      const role=await db.role.create({data:{organisationId:org.id,name:'Organisation owner',permissions:['*']}});
      await db.roleAssignment.create({data:{userId:actor.id,roleId:role.id}});await db.user.update({where:{id:actor.id},data:{passwordHash:'synthetic-route-fixture-only'}});
      const hooks:{session:{userId:string;organisationId:string;sessionVersion:number;mfaVerified:boolean}|null}={session:{userId:actor.id,organisationId:org.id,sessionVersion:0,mfaVerified:true}};
      const result=await build({entryPoints:['src/app/api/v1/billing/rent-reviews/route.ts'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'isolated-rent-route',setup(b){
        b.onResolve({filter:/^(?:@\/lib\/db|\.\/db)$/},()=>({path:'db',namespace:'rent-fixture'}));
        b.onResolve({filter:/^(?:@\/lib\/session|\.\/session)$/},()=>({path:'session',namespace:'rent-fixture'}));
        b.onResolve({filter:/generated\/prisma\/client$/},()=>({path:'prisma',namespace:'rent-fixture'}));
        b.onLoad({filter:/.*/,namespace:'rent-fixture'},args=>({contents:args.path==='db'?'export const db=__db;':args.path==='prisma'?'export const Prisma=__Prisma;':'export async function getSession(){return __hooks.session;}'}));
      }}]});
      const loaded={exports:{} as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}};
      new Function('require','module','exports','__db','__hooks','__Prisma',result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,hooks,Prisma);
      const get=()=>loaded.exports.GET(new Request(`https://fixture.invalid/api/v1/billing/rent-reviews?facilityId=${facility.id}`));
      const post=(body:unknown,origin='https://fixture.invalid')=>loaded.exports.POST(new Request('https://fixture.invalid/api/v1/billing/rent-reviews',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
      assert.equal((await get()).status,200);
      assert.equal((await post({action:'preview',input:base},'https://foreign.invalid')).status,403);
      assert.equal((await post({action:'preview',input:{...base,selectedOccupancyIds:[a.id,a.id]}})).status,422);
      assert.equal((await post({action:'review-status',input:{facilityId:facility.id,occupancyId:b.id,status:'DISMISSED',reason:'bad',expectedUpdatedAt:null}})).status,422);
      assert.equal((await post({action:'approve',input:selected,noticeConfirmed:false})).status,422);
      assert.equal((await post(null)).status,422);
      hooks.session!.mfaVerified=false;assert.equal((await get()).status,403);hooks.session!.mfaVerified=true;
      await db.role.update({where:{id:role.id},data:{name:'Former owner',permissions:['*']}});
      assert.equal((await get()).status,403);assert.equal((await post({action:'review-status',input:{}})).status,403);
      hooks.session=null;assert.equal((await get()).status,401);
    });
  }finally{if(auditConstraint)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_rent_review_audit_failure');await db.$disconnect();}
});

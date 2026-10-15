import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import {transfer} from '../../src/lib/leasing-service';

test('isolated transfers consume one original occupancy and retain valid transactional audit pairs',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 async function fixture(){
  const key=randomUUID(),org=await db.organisation.create({data:{name:'Transfer concurrency CI',slug:key}}),facility=await db.facility.create({data:{organisationId:org.id,name:'Synthetic store',code:key}}),user=await db.user.create({data:{organisationId:org.id,name:'Synthetic staff',email:key+'@example.invalid'}}),customer=await db.customer.create({data:{organisationId:org.id,firstName:'Synthetic'}}),type=await db.unitType.create({data:{facilityId:facility.id,name:'Synthetic units'}});
  const units=await Promise.all([0,1,2].map(i=>db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:'T-'+i,floor:'Ground Floor',monthlyRate:950,status:i===0?'OCCUPIED':'AVAILABLE'}}))),account=await db.account.create({data:{customerId:customer.id,accountNumber:'TRANSFER-'+key,balance:0}}),tenancy=await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,status:'ACTIVE',startDate:new Date('2026-01-01'),occupancies:{create:{unitId:units[0].id,status:'ACTIVE',startDate:new Date('2026-01-01'),monthlyRate:950,accessState:'ACTIVE'}}}}),occupancy=await db.occupancy.findFirstOrThrow({where:{tenancyId:tenancy.id}});
  return{org,facility,user,units,account,tenancy,occupancy,scope:{organisationId:org.id,userId:user.id,facilityIds:[facility.id],unrestrictedFacilities:false}};
 }
 async function state(f:Awaited<ReturnType<typeof fixture>>){return{tenancy:await db.tenancy.findUniqueOrThrow({where:{id:f.tenancy.id}}),occupancies:await db.occupancy.findMany({where:{tenancyId:f.tenancy.id},orderBy:{id:'asc'}}),units:await db.unit.findMany({where:{facilityId:f.facility.id},orderBy:{id:'asc'}}),audits:await db.auditEvent.findMany({where:{entityId:f.tenancy.id},orderBy:{id:'asc'}}),account:await db.account.findUniqueOrThrow({where:{id:f.account.id}})}}
 try{
  await t.test('two transfers blocked after reading the same source commit only one pair and release the rejected destination',async()=>{
   const f=await fixture(),financial={account:await db.account.findUniqueOrThrow({where:{id:f.account.id}}),payments:await db.payment.count(),ledger:await db.ledgerEntry.count()};
   let release!:()=>void,ready!:()=>void;const held=new Promise<void>(resolve=>{ready=resolve}),unblock=new Promise<void>(resolve=>{release=resolve});
   const blocker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id"=${f.facility.id} FOR UPDATE`;ready();await unblock;},{timeout:15000});await held;
   const attempts=Promise.allSettled([transfer(f.scope,{tenancyId:f.tenancy.id,toUnitId:f.units[1].id,effectiveAt:new Date('2026-10-15T08:00:00Z')}),transfer(f.scope,{tenancyId:f.tenancy.id,toUnitId:f.units[2].id,effectiveAt:new Date('2026-10-15T08:00:00Z')})]);
   let overlap=false;
   try{const deadline=Date.now()+2500;while(Date.now()<deadline){const rows=await db.$queryRaw<{count:number}[]>`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE '%FROM "Facility"%' AND query LIKE '%FOR UPDATE%'`;if(rows[0].count>=2){overlap=true;break}await new Promise(resolve=>setTimeout(resolve,25));}}finally{release()}
   await blocker;const result=await attempts;assert.equal(overlap,true,'Both original-source reads must reach the held facility lock');assert.equal(result.filter(r=>r.status==='fulfilled').length,1);const rejected=result.find(r=>r.status==='rejected');assert.equal(rejected?.status,'rejected');if(rejected?.status==='rejected')assert.match(String(rejected.reason),/CONFLICT/);
   const final=await state(f),active=final.occupancies.filter(o=>o.status==='ACTIVE');assert.equal(active.length,1);assert.equal(final.occupancies.length,2);assert.equal(final.audits.length,1);assert.equal(final.units.filter(u=>u.status==='OCCUPIED').length,1);assert.equal(final.units.find(u=>u.id===active[0].unitId)?.status,'OCCUPIED');assert.equal(final.units.find(u=>u.id===f.units[0].id)?.status,'AVAILABLE');
   assert.deepEqual(final.audits[0].before,{unitId:f.units[0].id,occupancyId:f.occupancy.id});assert.equal((final.audits[0].after as {occupancyId:string}).occupancyId,active[0].id);assert.equal(active[0].accessState,'PENDING');assert.equal(final.occupancies.find(o=>o.id===f.occupancy.id)?.accessState,'REVOKED');
   assert.deepEqual({account:await db.account.findUniqueOrThrow({where:{id:f.account.id}}),payments:await db.payment.count(),ledger:await db.ledgerEntry.count()},financial);
  });
  await t.test('same unit and dates before the original occupancy start cannot alter units or create history',async()=>{
   const f=await fixture(),before=await state(f);await assert.rejects(transfer(f.scope,{tenancyId:f.tenancy.id,toUnitId:f.units[0].id,effectiveAt:new Date('2026-10-15')}),/CONFLICT/);await assert.rejects(transfer(f.scope,{tenancyId:f.tenancy.id,toUnitId:f.units[1].id,effectiveAt:new Date('2025-12-31')}),/CONFLICT/);assert.deepEqual(await state(f),before);
  });
  await t.test('an audit failure rolls back source consumption, destination claim and new occupancy',async()=>{
   const f=await fixture(),before=await state(f);await db.$executeRawUnsafe(`CREATE FUNCTION ci_reject_transfer_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='tenancy.transferred' THEN RAISE EXCEPTION 'Synthetic transfer audit failure'; END IF; RETURN NEW; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER ci_reject_transfer_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ci_reject_transfer_audit()`);
   try{await assert.rejects(transfer(f.scope,{tenancyId:f.tenancy.id,toUnitId:f.units[1].id,effectiveAt:new Date('2026-10-15')}),/Synthetic transfer audit failure/);assert.deepEqual(await state(f),before);}finally{await db.$executeRawUnsafe(`DROP TRIGGER ci_reject_transfer_audit ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION ci_reject_transfer_audit()`);}
  });
 }finally{await db.$disconnect()}
});

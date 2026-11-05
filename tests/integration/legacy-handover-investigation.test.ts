import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../../src/lib/db';
import { leadsWorkspace, updateLead } from '../../src/lib/leads-workspace-service';
import { moveIn, completeBlendSignEnvelope, listLeasing, createReservation } from '../../src/lib/leasing-service';

test('legacy signature does not establish recorded handover', async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, 'isolated-ci');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'localhost');
  try {
  const key = randomUUID();
  const org = await db.organisation.create({data:{name:'Synthetic tenant lifecycle',slug:key}});
  const facility = await db.facility.create({data:{organisationId:org.id,name:'Synthetic store',code:key}});
  const staff = await db.user.create({data:{organisationId:org.id,name:'Synthetic staff',email:`${key}@example.invalid`}});
  const customer = await db.customer.create({data:{organisationId:org.id,firstName:'Synthetic'}});
  const lead=await db.lead.create({data:{facilityId:facility.id,customerId:customer.id,source:'Synthetic'}});
  const unitType = await db.unitType.create({data:{facilityId:facility.id,name:'Synthetic',features:[]}});
  const unit = await db.unit.create({data:{facilityId:facility.id,unitTypeId:unitType.id,number:key,monthlyRate:100,status:'AVAILABLE'}});
  const scope={organisationId:org.id,userId:staff.id,facilityIds:[facility.id],unrestrictedFacilities:false};
  const reservation=await createReservation(scope,{facilityId:facility.id,customerId:customer.id,unitId:unit.id,leadId:lead.id,quotedRate:100});
  const draft = await moveIn(scope,{reservationId:reservation.id,facilityId:facility.id,customerId:customer.id,unitId:unit.id,startDate:new Date(),initialCharge:100,accessState:'PENDING',paymentMethod:'EFT'});
  const envelope=`synthetic-${key}`;
  await db.document.update({where:{id:draft.document.id},data:{externalId:envelope,status:'SENT'}});
  await completeBlendSignEnvelope(envelope);
  const signed=await db.tenancy.findUniqueOrThrow({where:{id:draft.tenancy.id},include:{occupancies:true}});
  assert.equal(signed.status,'ACTIVE');
  assert.equal(signed.occupancies[0].status,'ACTIVE');
  assert.equal(await db.auditEvent.count({where:{organisationId:org.id,facilityId:facility.id,entityId:signed.id,action:'tenancy.key_handover_confirmed'}}),0);
  const listed=await listLeasing(scope,true);
  assert.equal(listed.customers.find(c=>c.id===customer.id)?.tenancies[0].handedOver,false);
  const before=(await leadsWorkspace(scope)).leads.find(l=>l.id===lead.id)!;
  assert.equal(before.stage,'RESERVED');
  await assert.rejects(updateLead(scope,lead.id,{updatedAt:before.updatedAt.toISOString(),stage:'WON',notes:'',nextActionAt:null,assignedToId:null}),/LEAD_BOOKING_STAGE/);
  await db.auditEvent.create({data:{organisationId:org.id,facilityId:facility.id,actorId:staff.id,entityType:'Tenancy',entityId:signed.id,action:'tenancy.key_handover_confirmed'}});
  assert.equal((await leadsWorkspace(scope)).leads.find(l=>l.id===lead.id)?.stage,'WON');
  assert.equal((await listLeasing(scope,true)).customers.find(c=>c.id===customer.id)?.tenancies[0].handedOver,true);
  assert.equal(await db.document.count({where:{id:draft.document.id,status:'SIGNED'}}),1);
  assert.equal(await db.ledgerEntry.count({where:{accountId:draft.tenancy.accountId}}),1);
  } finally { await db.$disconnect(); }
});

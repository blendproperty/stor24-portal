import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{db}from'../../src/lib/db';import{createManualLead}from'../../src/lib/manual-lead-service';import{updateLead,leadsWorkspace}from'../../src/lib/leads-workspace-service';import{releaseLeadBookingStage}from'../../src/lib/lead-booking-stage';import{createPublicLead}from'../../src/lib/public-lead-service';
const enabled=process.env.LEADS_DB_TEST==='isolated-ci';
test('lead updates are scoped, concurrent-safe, auditable and cannot fabricate a booking outcome',{skip:!enabled},async()=>{
 assert.ok(["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
 const key=randomUUID();const org=await db.organisation.create({data:{name:`Leads fixture ${key}`,slug:key}});
 try{const f=await db.facility.create({data:{organisationId:org.id,name:'Fixture store',code:key}});const other=await db.facility.create({data:{organisationId:org.id,name:'Excluded store',code:randomUUID()}});const user=await db.user.create({data:{organisationId:org.id,name:'Fixture owner',email:`${key}@example.invalid`,passwordHash:'not-a-login'}});const role=await db.role.create({data:{organisationId:org.id,name:'Fixture',permissions:['leads.*']}});await db.roleAssignment.create({data:{userId:user.id,roleId:role.id,facilityId:f.id}});const lead=await db.lead.create({data:{facilityId:f.id,source:'Phone'}});await db.lead.create({data:{facilityId:other.id,source:'Hidden'}});const scope={organisationId:org.id,userId:user.id,facilityIds:[f.id],unrestrictedFacilities:false};const input={updatedAt:lead.updatedAt.toISOString(),stage:'CONTACTED' as const,nextActionAt:'2026-10-12T12:30:00.000Z',notes:'Fixture follow-up',assignedToId:user.id};
 await db.facility.update({where:{id:f.id},data:{publicSlug:`fixture-${key}`,publicBookingEnabled:true}});
 const attribution={version:1 as const,consent:'granted' as const,landingPage:'/business-storage',conversionPage:'/book',pages:['/business-storage','/contact'],source:'google' as const,medium:'cpc' as const};
 const quote=await createPublicLead({firstName:'Fixture',lastName:'Visitor',email:`visitor-${key}@example.invalid`,phone:'+27000000000',facilitySlug:`fixture-${key}`,attribution,enquiryLocation:{city:"Pretoria",postalCode:"0081"}},'fixture-ip-hash');
 const attributed=(await leadsWorkspace(scope)).leads.find(l=>l.id===quote.id);assert.deepEqual(attributed?.attribution,attribution);assert.equal(attributed?.enquiryLocation?.postalCode,"0081");assert.equal(attributed?.enquiryLocation?.source,"PUBLIC_SELF_REPORTED");assert.equal(await db.reservation.count({where:{leadId:quote.id}}),0);
 assert.equal((await leadsWorkspace(scope)).leads.length,2);assert.equal((await leadsWorkspace({...scope,facilityIds:[]})).leads.length,0);
 const captureInput={facilityId:f.id,source:"Other" as const,enquiryLocation:{city:"Johannesburg",province:"Gauteng",postalCode:"2001"},sourceDetail:"School newsletter",firstName:"Manual",lastName:"Customer",phone:"+27000000000",submissionId:randomUUID()};
 const captures=await Promise.all([createManualLead(scope,captureInput),createManualLead(scope,captureInput)]);assert.equal(captures[0].id,captures[1].id);
 const captured=await db.lead.findUniqueOrThrow({where:{id:captures[0].id}});assert.equal(captured.notes,"Other source: School newsletter");assert.equal((captured.enquiryLocation as {source:string}).source,"STAFF_RECORDED");assert.equal(await db.customer.count({where:{organisationId:org.id,firstName:"Manual"}}),1);
 const reused=await createManualLead(scope,{facilityId:f.id,source:"Walk-in",customerId:captured.customerId!});assert.equal(reused.customerId,captured.customerId);
 const customerBefore=await db.customer.update({where:{id:captured.customerId!},data:{billingAddress:{city:"Verified billing city",postalCode:"9999"}}});
 const originalPublicCustomer=await db.customer.update({where:{id:attributed!.customer!.id},data:{billingAddress:{city:"Original billing location",postalCode:"1000"}}});
 const publicExisting=await createPublicLead({firstName:"Anonymous",lastName:"Visitor",email:`visitor-${key}@example.invalid`,phone:"+27000000000",facilitySlug:`fixture-${key}`,enquiryLocation:{city:"Cape Town",postalCode:"0001"}},"fixture-ip-hash");
 assert.equal((await db.lead.findUniqueOrThrow({where:{id:publicExisting.id}})).customerId,attributed!.customer!.id);
 const publicCustomer=await db.customer.findUniqueOrThrow({where:{id:attributed!.customer!.id}});
 assert.deepEqual(publicCustomer.billingAddress,originalPublicCustomer.billingAddress);
 const amendment={updatedAt:captured.updatedAt.toISOString(),stage:captured.stage,nextActionAt:null,assignedToId:user.id,notes:captured.notes||"",enquiryLocation:{city:"Durban",postalCode:"0400"}};
 await assert.rejects(updateLead({...scope,facilityIds:[other.id]},captured.id,amendment),/NOT_FOUND/);
 await updateLead(scope,captured.id,amendment);
 const relocated=await db.lead.findUniqueOrThrow({where:{id:captured.id}});
 assert.equal((relocated.enquiryLocation as {postalCode:string}).postalCode,"0400");
 assert.deepEqual((await db.customer.findUniqueOrThrow({where:{id:captured.customerId!}})).billingAddress,customerBefore.billingAddress);
 await assert.rejects(updateLead(scope,captured.id,{...amendment,enquiryLocation:{city:"Stale overwrite"}}),/CONFLICT/);
 const locationConstraint=`location_audit_${key.replaceAll('-','')}`;
 await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${locationConstraint}" CHECK ("entityId" <> '${captured.id}' OR "action" <> 'lead.updated') NOT VALID`);
 try{await assert.rejects(updateLead(scope,captured.id,{...amendment,updatedAt:relocated.updatedAt.toISOString(),enquiryLocation:{city:"Must roll back"}}));assert.deepEqual((await db.lead.findUniqueOrThrow({where:{id:captured.id}})).enquiryLocation,relocated.enquiryLocation);}finally{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${locationConstraint}"`);}
 await updateLead(scope,captured.id,{...amendment,updatedAt:relocated.updatedAt.toISOString(),enquiryLocation:{}});
 assert.equal((await db.lead.findUniqueOrThrow({where:{id:captured.id}})).enquiryLocation,null);
 await assert.rejects(createManualLead({...scope,facilityIds:[other.id]}, {facilityId:other.id,source:"Walk-in",customerId:captured.customerId!}),/FORBIDDEN/);
 await assert.rejects(createManualLead(scope,{...captureInput,phone:"+27000000001"}),/CONFLICT/);
 const newContact={...captureInput,firstName:"Rollback",submissionId:randomUUID()};const leadConstraint=`capture_audit_${key.replaceAll('-','')}`;
 await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${leadConstraint}" CHECK ("action" <> 'lead.capture.saved' OR "entityId" <> '${newContact.submissionId}') NOT VALID`);
 try{await assert.rejects(createManualLead(scope,newContact));assert.equal(await db.customer.count({where:{organisationId:org.id,firstName:"Rollback"}}),0);}finally{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${leadConstraint}"`);}

 await assert.rejects(updateLead({...scope,facilityIds:[other.id]},lead.id,input),/NOT_FOUND/);
 await assert.rejects(updateLead(scope,lead.id,{...input,stage:'WON'}),/LEAD_BOOKING_STAGE/);await assert.rejects(updateLead(scope,lead.id,{...input,stage:'RESERVED'}),/LEAD_BOOKING_STAGE/);
 const results=await Promise.allSettled([updateLead(scope,lead.id,input),updateLead(scope,lead.id,{...input,stage:'QUALIFIED'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const saved=await db.lead.findUniqueOrThrow({where:{id:lead.id}});assert.equal(saved.nextActionAt?.toISOString(),input.nextActionAt);assert.equal(saved.assignedToId,user.id);const audit=await db.auditEvent.findFirstOrThrow({where:{entityId:lead.id,action:'lead.updated'}});assert.equal(audit.actorId,user.id);assert.equal((audit.before as {stage:string}).stage,'NEW');assert.equal((audit.after as {stage:string}).stage,saved.stage);assert.equal(await db.auditEvent.count({where:{entityId:lead.id,action:'lead.updated'}}),1);
 await assert.rejects(updateLead(scope,lead.id,input),/CONFLICT/);
 await db.lead.update({where:{id:lead.id},data:{stage:'RESERVED'}});
 await db.$transaction(tx=>releaseLeadBookingStage(tx,{leadId:lead.id,facilityId:f.id,organisationId:org.id,actorId:user.id,reservationId:'fixture-ended-hold'}));
 const released=await db.lead.findUniqueOrThrow({where:{id:lead.id}});assert.equal(released.stage,'QUOTED');assert.equal(await db.auditEvent.count({where:{entityId:lead.id,action:'lead.stage_changed'}}),1);
 const constraint=`leads_audit_${key.replaceAll('-','')}`;await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${constraint}" CHECK ("entityId" <> '${lead.id}' OR "action" <> 'lead.updated') NOT VALID`);
 try{await assert.rejects(updateLead(scope,lead.id,{...input,updatedAt:released.updatedAt.toISOString(),notes:'Must roll back'}));assert.equal((await db.lead.findUniqueOrThrow({where:{id:lead.id}})).notes,released.notes);}finally{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${constraint}"`);}
 }finally{await db.roleAssignment.deleteMany({where:{user:{organisationId:org.id}}});await db.lead.deleteMany({where:{facility:{organisationId:org.id}}});await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.user.deleteMany({where:{organisationId:org.id}});await db.organisation.delete({where:{id:org.id}});await db.$disconnect();}
});

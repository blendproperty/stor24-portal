import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import {encryptIntegrationSecret} from '../../src/lib/integrations/integration-secret-vault';
import {observeDebiCheckTemplate,reviewDebiCheckTemplate,listDebiCheckTemplates,DEBICHECK_TEMPLATE_DOMAIN} from '../../src/lib/payments/netcash-debicheck-template-service';

test('isolated DebiCheck observations and independent reviews cannot alter money or activate a bank request',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');assert.equal(new URL(process.env.DATABASE_URL!).hostname,'localhost');
 process.env.AUTH_SECRET='synthetic-debicheck-ci-auth-secret-at-least-32';process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY='synthetic-debicheck-ci-vault-secret-at-least-32';
 const org=await db.organisation.create({data:{name:'DebiCheck CI',slug:randomUUID()}}),store=await db.facility.create({data:{organisationId:org.id,code:randomUUID(),name:'Synthetic store'}}),other=await db.facility.create({data:{organisationId:org.id,code:randomUUID(),name:'Other store'}});
 const users=await Promise.all(['Requester','Reviewer'].map(name=>db.user.create({data:{organisationId:org.id,email:randomUUID()+'@example.invalid',name}})));
 const key=randomUUID(),config={environment:'test',debitOrderServiceKeyEncrypted:encryptIntegrationSecret(key),merchantAccountEncrypted:encryptIntegrationSecret('53000000000'),transactionProcessingEnabled:false};
 const c=await db.integrationConnection.create({data:{organisationId:org.id,category:'PAYMENTS',provider:'NETCASH',status:'HEALTHY',config}});
 const scope={organisationId:org.id,userId:users[0].id,facilityIds:[store.id],unrestrictedFacilities:false},reviewer={...scope,userId:users[1].id},templateId='NCDCT000000001';
 const baseline={payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count(),accounts:await db.account.findMany({orderBy:{id:'asc'}})};
 let calls=0,changed=false;const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Real provider transport forbidden')};
 const request:typeof fetch=async(_url,options)=>{
  calls++;assert.equal((options!.headers as Record<string,string>).SOAPAction,'"http://tempuri.org/INIWS_NIF/DebiCheckRetrieveMandateTemplateDetail"');assert.match(String(options!.body),/<DebiCheckMandateTemplateId>NCDCT000000001<\/DebiCheckMandateTemplateId>/);
  const fields={AdjustmentAmount:'0.0000',AdjustmentCategory:'N',AdjustmentRuleIndicator:'Y',AdjustmentType:'AMNT',AuthenticationType:'BATCH',CollectionFrequency:'MNTH',CollectionFrequencyDayCode:'MNTH_01',DebitEntryClassCode:'0036',DebitValueType:'USAGE BASED',DebtorAuthCode:'Batch (TT2)',DebtorAuthenticationRequired:'0227',InstallmentOccurrence:'RCUR',RMS:'False',TemplateName:changed?'Changed synthetic template':'Synthetic template',TrackingDayCode:'01 Day tracking',TrackingIndicator:'Y'};
  return new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><DebiCheckRetrieveMandateTemplateDetailResponse xmlns="http://tempuri.org/"><DebiCheckRetrieveMandateTemplateDetailResult xmlns:a="http://schemas.datacontract.org/2004/07/NC.DG.TMS.C.WCF.NIWS"><a:ErrorCode>000</a:ErrorCode><a:TemplateId>${templateId}</a:TemplateId>${Object.entries(fields).map(([name,value])=>`<a:${name}>${value}</a:${name}>`).join('')}<a:InitiationDayOptions xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><b:string>MNTH_01</b:string></a:InitiationDayOptions></DebiCheckRetrieveMandateTemplateDetailResult></DebiCheckRetrieveMandateTemplateDetailResponse></s:Body></s:Envelope>`);
 };
 async function observe(){return observeDebiCheckTemplate(scope,{facilityId:store.id,templateId},request)}
 try{
 await t.test('signed observation retains immutable provider terms and a different reviewer rechecks them',async()=>{
  const row=await observe(),before=await db.configurationProfile.findUniqueOrThrow({where:{id:row.id}});assert.equal(row.status,'PENDING_REVIEW');assert.ok(!JSON.stringify(before.config).includes(key));
  const count=calls;await assert.rejects(reviewDebiCheckTemplate(scope,{id:row.id,confirmed:true},request),/INDEPENDENT_REVIEW/);assert.equal(calls,count);
  const result=await reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request);assert.equal(result.status,'REVIEWED');assert.equal(result.collectionEnabled,false);assert.equal(result.authenticationSubmissionEnabled,false);assert.equal(calls,count+1);
  assert.deepEqual((await db.configurationProfile.findUniqueOrThrow({where:{id:row.id}})).config,before.config);assert.equal(await db.auditEvent.count({where:{entityId:row.id}}),2);
 });
 await t.test('store and organisation isolation rejects reads/reviews before provider lookup',async()=>{
  const row=await observe(),count=calls;await assert.rejects(listDebiCheckTemplates({...scope,facilityIds:[other.id]},store.id),/FORBIDDEN/);await assert.rejects(reviewDebiCheckTemplate({...reviewer,facilityIds:[other.id]},{id:row.id,confirmed:true},request),/FORBIDDEN/);await assert.rejects(reviewDebiCheckTemplate({...reviewer,organisationId:'unrelated-org'},{id:row.id,confirmed:true},request),/NOT_FOUND/);assert.equal(calls,count);
 });
 await t.test('a fresh observation retains prior history and copied evidence cannot be attached to another record',async()=>{
  const first=await observe(),second=await observe();assert.notEqual(first.id,second.id);
  const a=await db.configurationProfile.findUniqueOrThrow({where:{id:first.id}}),b=await db.configurationProfile.findUniqueOrThrow({where:{id:second.id}});assert.notEqual(a.name,b.name);
  const history=await listDebiCheckTemplates(scope,store.id);assert.ok(history.records.some(row=>row.id===first.id));assert.ok(history.records.some(row=>row.id===second.id));
  await db.configurationProfile.update({where:{id:second.id},data:{config:a.config!}});await assert.rejects(reviewDebiCheckTemplate(reviewer,{id:second.id,confirmed:true},request),/INTEGRITY_REVIEW/);await db.configurationProfile.update({where:{id:second.id},data:{config:b.config!}});
 });
 await t.test('changed provider terms and expired confirmation cannot save review',async()=>{
  const row=await observe();changed=true;await assert.rejects(reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request),/SOURCE_CHANGED/);changed=false;
  await assert.rejects(reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request,new Date(Date.now()+901000)),/REVIEW_EXPIRED/);assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:row.id}})).status,'PENDING_REVIEW');
 });
 await t.test('changed connection or disabled test configuration preserves retained history with source held',async()=>{
  const row=await observe();await db.integrationConnection.update({where:{id:c.id},data:{config:{...config,environment:'live'}}});
  const history=await listDebiCheckTemplates(scope,store.id);assert.ok(history.records.some(r=>r.id===row.id&&!r.sourceCurrent));await assert.rejects(reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request),/TEST_CONFIGURATION/);
  await db.integrationConnection.update({where:{id:c.id},data:{config}});await assert.rejects(reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request),/CONFIGURATION_CHANGED/);
 });
 await t.test('tampered snapshot cannot be read as verified template evidence',async()=>{
  const row=await observe(),stored=await db.configurationProfile.findUniqueOrThrow({where:{id:row.id}}),value=structuredClone(stored.config) as {snapshot:{detail:Record<string,string>}};value.snapshot.detail.TemplateName='Unverified replacement';
  await db.configurationProfile.update({where:{id:row.id},data:{config:value}});await assert.rejects(reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request),/INTEGRITY_REVIEW/);await db.configurationProfile.update({where:{id:row.id},data:{config:stored.config!}});
 });
 await t.test('concurrent independent reviews save at most one review audit',async()=>{
  const row=await observe(),results=await Promise.allSettled([reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request),reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.auditEvent.count({where:{entityId:row.id,action:'netcash.debicheck_template_reviewed'}}),1);
 });
 await t.test('audit failure rolls back both an observation and review state',async()=>{
  const row=await observe(),before=await db.configurationProfile.count({where:{organisationId:org.id,domain:DEBICHECK_TEMPLATE_DOMAIN}});
  await db.$executeRawUnsafe(`CREATE FUNCTION ci_reject_debicheck_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('netcash.debicheck_template_observed','netcash.debicheck_template_reviewed') THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER ci_reject_debicheck_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ci_reject_debicheck_audit()`);
  try{await assert.rejects(observe(),/Synthetic audit failure/);assert.equal(await db.configurationProfile.count({where:{organisationId:org.id,domain:DEBICHECK_TEMPLATE_DOMAIN}}),before);await assert.rejects(reviewDebiCheckTemplate(reviewer,{id:row.id,confirmed:true},request),/Synthetic audit failure/);assert.equal((await db.configurationProfile.findUniqueOrThrow({where:{id:row.id}})).status,'PENDING_REVIEW');}finally{await db.$executeRawUnsafe(`DROP TRIGGER ci_reject_debicheck_audit ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION ci_reject_debicheck_audit()`);}
 });
 assert.deepEqual({payments:await db.payment.count(),ledger:await db.ledgerEntry.count(),instructions:await db.debitOrderInstruction.count(),accounts:await db.account.findMany({orderBy:{id:'asc'}})},baseline);
 }finally{globalThis.fetch=original;await db.$disconnect()}
});

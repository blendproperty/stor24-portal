import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { type Prisma } from '@/generated/prisma/client';
import { requireFacility,type FacilityScope,type RequestScope } from '@/lib/scope';
import { tenantCustomerScope } from '@/lib/tenant-portal-security';
import { billingPlanSchema,calculateMonthlyBill } from '@/lib/monthly-billing-policy';
import { rentRatesForBilling } from '@/lib/rent-review-service';
import { cardAutopayPeriods,fixedCardAutopayAmount } from './card-autopay-policy';
import { CARD_SUBSCRIPTION_DOMAIN,CARD_SUBSCRIPTION_OPEN_STATUSES,cardSourceHash } from './card-autopay-enrollment-policy';
import { reviewedDebiCheckTemplate } from './netcash-debicheck-template-service';
import { DEBICHECK_REQUEST_DOMAIN,DEBICHECK_REQUEST_TERMS,debiCheckPayerSchema,debiCheckRequestSignature,debiCheckSetupRequestText,encryptDebiCheckTerms,privateDebiCheckTerms,projectDebiCheckRequest,readDebiCheckRequest,sealDebiCheckRequest } from './netcash-debicheck-request-policy';
import {DEBICHECK_ATTEMPT_DOMAIN} from './netcash-debicheck-attempt-policy';

type Client=Prisma.TransactionClient;
type Tenant={organisationId:string;email:string;customerIds:string[]};
type Owner={organisationId:string;customerId:string;email:string};
const tenantScope=(organisationId:string,facilityId:string):FacilityScope=>({organisationId,facilityIds:[facilityId],unrestrictedFacilities:false});
function enabled(){if(process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED!=='true')throw Error('DEBICHECK_PREPARATION_DISABLED');}
async function owner(client:Client,session:Tenant,accountId:string){
 const account=await client.account.findFirst({where:{id:accountId,customer:tenantCustomerScope(session)},select:{customerId:true,tenancy:{select:{facilityId:true}}}});
 if(!account?.tenancy)throw Error('TENANT_NOT_FOUND');
 return{organisationId:session.organisationId,customerId:account.customerId,email:session.email,facilityId:account.tenancy.facilityId};
}
/** Fixed monthly preparation only. No amount is accepted from the caller, and
 * the whole source is rechecked at consent and independent review. */
async function source(client:Client,identity:Owner,accountId:string,startDate:string,now:Date){
 const periods=cardAutopayPeriods({startDate,cycles:12},now);
 const account=await client.account.findFirst({where:{id:accountId,customer:tenantCustomerScope({...identity,customerIds:[identity.customerId]})},include:{tenancy:{include:{
  occupancies:{include:{unit:true},orderBy:{id:'asc'}},insuranceEnrollment:true,
  mandateSession:{select:{mandate:{select:{status:true}}}},
  documents:{where:{type:'LEASE_AGREEMENT',status:'SIGNED',signedAt:{not:null}},select:{id:true,signedAt:true},orderBy:{id:'asc'}},
  reservation:{select:{publicLease:{select:{id:true,status:true,signedAt:true,mandate:{select:{status:true}}}}}},
 }}}});
 const tenancy=account?.tenancy;
 if(!account||!tenancy||tenancy.customerId!==account.customerId)throw Error('DEBICHECK_ACCOUNT_NOT_FOUND');
 if(tenancy.status!=='ACTIVE'||tenancy.endDate||tenancy.noticeDate||account.currency!=='ZAR')throw Error('DEBICHECK_ACCOUNT_REVIEW');
 if(Number(account.balance)<0||await client.payment.count({where:{accountId,status:{in:['PENDING','TEST_PENDING']}}})||await client.ledgerEntry.count({where:{accountId,type:{in:['CHARGE','CREDIT','REVERSAL','WRITE_OFF']},effectiveAt:{gte:new Date(startDate+'T00:00:00+02:00')}}}))throw Error('DEBICHECK_ALLOCATION_REVIEW');
 const publicLease=tenancy.reservation?.publicLease;
 if(!tenancy.documents.length&&!(publicLease?.status==='SIGNED'&&publicLease.signedAt))throw Error('DEBICHECK_SIGNED_LEASE_REQUIRED');
 if(tenancy.paymentMethod==='DEBIT_ORDER'||tenancy.mandateSession?.mandate?.status==='SIGNED'||publicLease?.mandate?.status==='SIGNED'||await client.debitOrderInstruction.count({where:{accountId}})||await client.configurationProfile.count({where:{organisationId:identity.organisationId,domain:CARD_SUBSCRIPTION_DOMAIN,name:accountId,status:{in:CARD_SUBSCRIPTION_OPEN_STATUSES}}})||await client.configurationProfile.count({where:{organisationId:identity.organisationId,domain:'CARD_AUTOPAY_REQUEST',name:accountId,status:'REQUESTED'}}))throw Error('DEBICHECK_OTHER_COLLECTION_REVIEW');
 const profile=await client.configurationProfile.findFirst({where:{organisationId:identity.organisationId,facilityId:tenancy.facilityId,domain:'MONTHLY_BILLING',name:accountId,status:'READY'}});
 if(!profile)throw Error('DEBICHECK_APPROVED_BILLING_REQUIRED');const plan=billingPlanSchema.parse(profile.config);
 if(periods[0]<plan.firstPeriod)throw Error('DEBICHECK_BILLING_PERIOD_REVIEW');
 const occupancies=tenancy.occupancies.filter(o=>o.status==='ACTIVE'&&!o.endDate);
 if(occupancies.length!==1||occupancies[0].unit.facilityId!==tenancy.facilityId)throw Error('DEBICHECK_OCCUPANCY_REVIEW');
 const bills=[];
 for(const period of periods){
  const rates=await rentRatesForBilling(client,identity.organisationId,tenancy.facilityId,occupancies,period);
  bills.push(calculateMonthlyBill(period,plan,occupancies.map(o=>({id:o.id,number:o.unit.number,monthlyRate:rates.get(o.id)!,startDate:o.startDate,endDate:o.endDate})),tenancy.insuranceEnrollment?{...tenancy.insuranceEnrollment,monthlyPremium:tenancy.insuranceEnrollment.monthlyPremium===null?null:Number(tenancy.insuranceEnrollment.monthlyPremium)}:null));
 }
 const monthlyAmount=fixedCardAutopayAmount(bills.map(b=>b.total));
 return{accountId,accountNumber:account.accountNumber,customerId:account.customerId,tenancyId:tenancy.id,facilityId:tenancy.facilityId,monthlyAmount,sourceHash:cardSourceHash({account:JSON.parse(JSON.stringify(account)),profile:JSON.parse(JSON.stringify(profile)),bills})};
}
export async function previewDebiCheckRequest(session:Tenant,input:{accountId:string;templateObservationId:string;startDate:string;payer:unknown},now=new Date()){
 enabled();const identity=await owner(db,session,input.accountId),payer=debiCheckPayerSchema.parse(input.payer),s=await source(db,identity,input.accountId,input.startDate,now);
 // A verified tenant may submit their own contact details only. Bank-owner
 // authority still requires the later provider mandate and bank authentication.
 if(payer.emailAddress.toLowerCase()!==identity.email.toLowerCase())throw Error('DEBICHECK_TENANT_CONTACT_REVIEW');
 const template=await reviewedDebiCheckTemplate(tenantScope(session.organisationId,s.facilityId),s.facilityId,input.templateObservationId,now);
 if(!template.monthlyDayOptions.includes('MNTH_01'))throw Error('DEBICHECK_TEMPLATE_DAY_REVIEW');
 const id='debicheck-request:'+randomUUID(),consentText=debiCheckSetupRequestText(s.monthlyAmount,input.startDate);
 const encryptedTerms=encryptDebiCheckTerms({...payer,accountReference:id.replace('debicheck-request:','').replaceAll('-',''),templateId:template.templateId,isIdNumber:payer.debtorIdentificationCode==='I',collectionAmount:s.monthlyAmount,firstCollectionDiffers:false,firstCollectionAmount:s.monthlyAmount,firstCollectionDate:input.startDate,monthlyCollectionDay:1});
 const preview=sealDebiCheckRequest({version:1,recordId:id,organisationId:session.organisationId,facilityId:s.facilityId,accountId:input.accountId,customerId:s.customerId,tenancyId:s.tenancyId,sourceHash:s.sourceHash,templateObservationId:template.observationId,templateSourceHash:template.sourceHash,templateId:template.templateId,connectionId:template.connectionId,connectionUpdatedAt:template.connectionUpdatedAt,merchantHash:template.merchantHash,environment:'sandbox',startDate:input.startDate,monthlyAmount:s.monthlyAmount,consentVersion:DEBICHECK_REQUEST_TERMS,consentText,consentAt:now.toISOString(),tenantIdentityHash:debiCheckRequestSignature({organisationId:session.organisationId,customerId:s.customerId,email:identity.email.toLowerCase()}),bankSuffix:payer.bankAccountNumber.slice(-4),encryptedTerms});
 return{preview,accountNumber:s.accountNumber,...projectDebiCheckRequest(preview,'PREVIEW'),expiresAt:new Date(now.getTime()+600000).toISOString()};
}
async function current(client:Client,definition:ReturnType<typeof readDebiCheckRequest>,identity:Owner,scope:FacilityScope,now:Date){
 const s=await source(client,identity,definition.accountId,definition.startDate,now);
 if(s.sourceHash!==definition.sourceHash||s.facilityId!==definition.facilityId||s.customerId!==definition.customerId||s.tenancyId!==definition.tenancyId||s.monthlyAmount!==definition.monthlyAmount||definition.consentText!==debiCheckSetupRequestText(s.monthlyAmount,definition.startDate)||definition.tenantIdentityHash!==debiCheckRequestSignature({organisationId:identity.organisationId,customerId:identity.customerId,email:identity.email.toLowerCase()}))throw Error('DEBICHECK_REQUEST_SOURCE_CHANGED');
 const template=await reviewedDebiCheckTemplate(scope,s.facilityId,definition.templateObservationId,now,client);
 if(template.templateId!==definition.templateId||template.sourceHash!==definition.templateSourceHash||template.connectionId!==definition.connectionId||template.connectionUpdatedAt!==definition.connectionUpdatedAt||template.merchantHash!==definition.merchantHash||!template.monthlyDayOptions.includes('MNTH_01'))throw Error('DEBICHECK_CONFIGURATION_CHANGED');
 privateDebiCheckTerms(definition);
 const c=await client.integrationConnection.findUniqueOrThrow({where:{id:template.connectionId}});
 if(c.updatedAt.toISOString()!==definition.connectionUpdatedAt)throw Error('DEBICHECK_CONFIGURATION_CHANGED');
 return{template};
}
/** Current original setup evidence for the separate bank-consent workflow.
 * This is a source read, not tenant authentication or permission to dispatch. */
export {current as recheckDebiCheckSetupSource};
export async function saveDebiCheckRequest(session:Tenant,input:{accountId:string;preview:unknown;accepted:boolean},now=new Date()){
 enabled();if(input.accepted!==true)throw Error('DEBICHECK_CONSENT_REQUIRED');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${input.accountId} FOR UPDATE`;
  const identity=await owner(tx,session,input.accountId),definition=readDebiCheckRequest(input.preview,{id:(input.preview as {recordId?:string})?.recordId??'',organisationId:session.organisationId,facilityId:identity.facilityId,accountId:input.accountId});
  if(definition.customerId!==identity.customerId)throw Error('TENANT_NOT_FOUND');
  const existing=await tx.configurationProfile.findUnique({where:{id:definition.recordId}});
  if(existing){const prior=readDebiCheckRequest(existing.config,{id:existing.id,organisationId:session.organisationId,facilityId:identity.facilityId,accountId:input.accountId});if(existing.domain!==DEBICHECK_REQUEST_DOMAIN||existing.name!==input.accountId+':'+definition.recordId.replace('debicheck-request:','')||prior.encryptedTerms!==definition.encryptedTerms||prior.sourceHash!==definition.sourceHash)throw Error('DEBICHECK_REQUEST_INTEGRITY_REVIEW');return projectDebiCheckRequest(prior,existing.status);}
  if(new Date(definition.consentAt)>now||now.getTime()-new Date(definition.consentAt).getTime()>600000)throw Error('DEBICHECK_REQUEST_PREVIEW_EXPIRED');
  if(await tx.configurationProfile.count({where:{organisationId:session.organisationId,domain:DEBICHECK_REQUEST_DOMAIN,config:{path:['accountId'],equals:input.accountId},status:{not:'WITHDRAWN'}}}))throw Error('DEBICHECK_REQUEST_EXISTS');
  await current(tx,definition,identity,tenantScope(session.organisationId,identity.facilityId),now);
  const saved=sealDebiCheckRequest({...definition,consentAt:now.toISOString()});
  // Preserve each withdrawn request under its own unique account/record name.
  await tx.configurationProfile.create({data:{id:saved.recordId,organisationId:session.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_REQUEST_DOMAIN,name:input.accountId+':'+saved.recordId.replace('debicheck-request:',''),status:'REQUESTED',config:saved}});
  await tx.auditEvent.create({data:{organisationId:session.organisationId,facilityId:identity.facilityId,action:'netcash.debicheck_request_consented',entityType:'ConfigurationProfile',entityId:saved.recordId,after:{accountId:input.accountId,customerId:identity.customerId,sourceHash:saved.sourceHash,requestSignature:saved.signature,consentVersion:saved.consentVersion,consentAt:saved.consentAt,authenticationSubmitted:false,collectionEnabled:false,financialPosting:false}}});
  return projectDebiCheckRequest(saved,'REQUESTED');
 },{isolationLevel:'Serializable',timeout:20000});
}
export async function listTenantDebiCheckRequests(session:Tenant,accountId:string,now=new Date()){
 const identity=await owner(db,session,accountId),rows=await db.configurationProfile.findMany({where:{organisationId:session.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_REQUEST_DOMAIN,config:{path:['accountId'],equals:accountId}},orderBy:{createdAt:'desc'},take:21});
 let templateObservationId:string|null=null;
 const available=process.env.NETCASH_DEBICHECK_REQUEST_PREPARATION_ENABLED==='true';
 if(available){
  const candidate=await db.configurationProfile.findFirst({where:{organisationId:session.organisationId,facilityId:identity.facilityId,domain:'NETCASH_DEBICHECK_TEMPLATE',status:'REVIEWED'},orderBy:{createdAt:'desc'}});
  if(candidate)try{await reviewedDebiCheckTemplate(tenantScope(session.organisationId,identity.facilityId),identity.facilityId,candidate.id,now);templateObservationId=candidate.id;}catch(error){if(!(error instanceof Error)||(!error.message.startsWith('DEBICHECK_')&&error.message!=='NETCASH_NOT_CONFIGURED'))throw error;}
 }
 return{available,templateObservationId,hasMore:rows.length>20,requests:rows.slice(0,20).map(row=>projectDebiCheckRequest(readDebiCheckRequest(row.config,{id:row.id,organisationId:session.organisationId,facilityId:identity.facilityId,accountId}),row.status))};
}
export async function withdrawDebiCheckRequest(session:Tenant,accountId:string,id:string){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${accountId} FOR UPDATE`;
  const identity=await owner(tx,session,accountId),row=await tx.configurationProfile.findFirst({where:{id,organisationId:session.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_REQUEST_DOMAIN}});
  if(!row)throw Error('TENANT_NOT_FOUND');
  const definition=readDebiCheckRequest(row.config,{id:row.id,organisationId:session.organisationId,facilityId:identity.facilityId,accountId});
  if(definition.customerId!==identity.customerId)throw Error('TENANT_NOT_FOUND');
  if(row.status==='WITHDRAWN')return projectDebiCheckRequest(definition,row.status);
  // Claim and withdrawal take the same account lock. Once an attempt is retained,
  // local withdrawal cannot cancel or permit a replay of an uncertain bank call.
  if(await tx.configurationProfile.findFirst({where:{organisationId:session.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_ATTEMPT_DOMAIN,name:row.id},select:{id:true}}))throw Error('DEBICHECK_PROVIDER_CANCELLATION_REVIEW');
  if(!['REQUESTED','REVIEWED'].includes(row.status))throw Error('DEBICHECK_PROVIDER_CANCELLATION_REVIEW');
  await tx.configurationProfile.update({where:{id},data:{status:'WITHDRAWN'}});
  await tx.auditEvent.create({data:{organisationId:session.organisationId,facilityId:identity.facilityId,action:'netcash.debicheck_request_withdrawn',entityType:'ConfigurationProfile',entityId:id,after:{accountId,customerId:identity.customerId,authenticationSubmitted:false,collectionEnabled:false}}});
  return projectDebiCheckRequest(definition,'WITHDRAWN');
 },{isolationLevel:'Serializable',timeout:20000});
}
export async function listStaffDebiCheckRequests(scope:RequestScope,facilityId:string){
 await requireFacility(scope,facilityId);
 const rows=await db.configurationProfile.findMany({where:{organisationId:scope.organisationId,facilityId,domain:DEBICHECK_REQUEST_DOMAIN},orderBy:{createdAt:'desc'},take:21});
 return{hasMore:rows.length>20,requests:await Promise.all(rows.slice(0,20).map(async row=>{
  const accountId=(row.config as {accountId?:unknown}|null)?.accountId;if(typeof accountId!=='string')throw Error('DEBICHECK_REQUEST_INTEGRITY_REVIEW');
  const definition=readDebiCheckRequest(row.config,{id:row.id,organisationId:scope.organisationId,facilityId,accountId});
  const account=await db.account.findFirst({where:{id:accountId,customerId:definition.customerId,customer:{organisationId:scope.organisationId},tenancy:{id:definition.tenancyId,facilityId}},select:{accountNumber:true}});
  if(!account)throw Error('DEBICHECK_REQUEST_ACCOUNT_REVIEW');
  return{...projectDebiCheckRequest(definition,row.status),accountNumber:account.accountNumber};
 }))};
}
export async function reviewDebiCheckRequest(scope:RequestScope,input:{id:string;confirmed:boolean},now=new Date()){
 enabled();if(input.confirmed!==true)throw Error('DEBICHECK_REVIEW_CONFIRMATION_REQUIRED');
 const initial=await db.configurationProfile.findFirst({where:{id:input.id,organisationId:scope.organisationId,domain:DEBICHECK_REQUEST_DOMAIN}});
 if(!initial?.facilityId)throw Error('DEBICHECK_REQUEST_NOT_FOUND');await requireFacility(scope,initial.facilityId);
 const accountId=(initial.config as {accountId?:unknown}|null)?.accountId;if(typeof accountId!=='string')throw Error('DEBICHECK_REQUEST_INTEGRITY_REVIEW');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${accountId} FOR UPDATE`;
  const row=await tx.configurationProfile.findUniqueOrThrow({where:{id:input.id}});
  if(row.status!=='REQUESTED'||row.updatedAt.getTime()!==initial.updatedAt.getTime()||row.facilityId!==initial.facilityId||row.organisationId!==scope.organisationId||row.domain!==DEBICHECK_REQUEST_DOMAIN)throw Error('DEBICHECK_REQUEST_SOURCE_CHANGED');
  const definition=readDebiCheckRequest(row.config,{id:row.id,organisationId:scope.organisationId,facilityId:initial.facilityId!,accountId});
  const customer=await tx.customer.findFirst({where:{id:definition.customerId,organisationId:scope.organisationId,emailVerifiedAt:{not:null}},select:{email:true}});
  if(!customer?.email)throw Error('DEBICHECK_TENANT_CONTACT_REVIEW');
  const reviewer=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},select:{email:true}});
  if(!reviewer||reviewer.email.toLowerCase()===customer.email.toLowerCase())throw Error('DEBICHECK_INDEPENDENT_REVIEW_REQUIRED');
  // Staff review cannot stand in for an authenticated tenant's consent event.
  const consent=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:initial.facilityId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_request_consented',actorId:null},orderBy:{occurredAt:'asc'}});
  const evidence=consent?.after as {customerId?:unknown;sourceHash?:unknown;consentAt?:unknown;requestSignature?:unknown}|null;
  if(!evidence||evidence.customerId!==definition.customerId||evidence.sourceHash!==definition.sourceHash||evidence.consentAt!==definition.consentAt||evidence.requestSignature!==definition.signature)throw Error('DEBICHECK_CONSENT_EVIDENCE_REVIEW');
  if(now<new Date(definition.consentAt))throw Error('DEBICHECK_REQUEST_PREVIEW_EXPIRED');
  await current(tx,definition,{organisationId:scope.organisationId,customerId:definition.customerId,email:customer.email},scope,now);
  await tx.configurationProfile.update({where:{id:row.id},data:{status:'REVIEWED'}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:initial.facilityId,actorId:scope.userId,action:'netcash.debicheck_request_reviewed',entityType:'ConfigurationProfile',entityId:row.id,after:{accountId,requestSignature:definition.signature,sourceHash:definition.sourceHash,authenticationSubmitted:false,collectionEnabled:false,financialPosting:false}}});
  return projectDebiCheckRequest(definition,'REVIEWED');
 },{isolationLevel:'Serializable',timeout:20000});
}

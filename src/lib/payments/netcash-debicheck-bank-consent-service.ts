import {db} from '@/lib/db';
import {z} from 'zod';
import type {Prisma} from '@/generated/prisma/client';
import type {RequestScope} from '@/lib/scope';
import {tenantCustomerScope} from '@/lib/tenant-portal-security';
import {currentRoleAccess} from '@/lib/current-role-access';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {DEBICHECK_ATTEMPT_DOMAIN} from './netcash-debicheck-attempt-policy';
import {currentBankConsentSource} from './netcash-debicheck-bank-consent-source';
import {encryptBankConsent,readStoredBankConsent} from './netcash-debicheck-bank-consent-record';
import {DEBICHECK_BANK_CONSENT_DOMAIN,prepareBankAuthenticationConsent,readBankAuthenticationConsent,acceptBankAuthenticationConsent,projectBankAuthenticationConsent,bankAuthenticationConsentHash,type DebiCheckBankConsent} from './netcash-debicheck-bank-consent-policy';

type Tx=Prisma.TransactionClient;
type Tenant={organisationId:string;email:string;customerIds:string[]};
type Row=Awaited<ReturnType<Tx['configurationProfile']['findUniqueOrThrow']>>;
function enabled(){if(process.env.NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED!=='true')throw Error('DEBICHECK_BANK_CONSENT_DISABLED')}
const scopeFor=(organisationId:string,facilityId:string)=>({organisationId,facilityIds:[facilityId],unrestrictedFacilities:false});
async function owner(tx:Tx,session:Tenant,accountId:string){
 const account=await tx.account.findFirst({where:{id:accountId,customer:tenantCustomerScope(session),tenancy:{facility:{organisationId:session.organisationId}}},select:{customerId:true,tenancy:{select:{id:true,facilityId:true,customerId:true}}}});
 if(!account?.tenancy||account.customerId!==account.tenancy.customerId)throw Error('TENANT_NOT_FOUND');
 return{organisationId:session.organisationId,customerId:account.customerId,email:session.email,facilityId:account.tenancy.facilityId,tenancyId:account.tenancy.id};
}
function read(row:Row,identity:{organisationId:string;facilityId:string;accountId:string;customerId:string;tenancyId:string}){
 if(row.organisationId!==identity.organisationId||row.facilityId!==identity.facilityId||row.domain!==DEBICHECK_BANK_CONSENT_DOMAIN||row.name!==row.id||!['CONSENTED','REVIEWED','WITHDRAWN'].includes(row.status))throw Error('DEBICHECK_BANK_CONSENT_INTEGRITY');
 const value=readStoredBankConsent(row.config,{id:row.id,...identity});
 if(value.source.tenancyId!==identity.tenancyId)throw Error('DEBICHECK_BANK_CONSENT_INTEGRITY');
 return value;
}
async function attempted(tx:Tx,value:DebiCheckBankConsent){return !!await tx.configurationProfile.findFirst({where:{organisationId:value.source.organisationId,facilityId:value.source.facilityId,domain:DEBICHECK_ATTEMPT_DOMAIN,name:value.source.requestId},select:{id:true}})}
async function project(tx:Tx,value:DebiCheckBankConsent,status:string,now:Date){
 if(!['CONSENTED','REVIEWED','WITHDRAWN'].includes(status))throw Error('DEBICHECK_BANK_CONSENT_STATE');
 return{...projectBankAuthenticationConsent(value,status as 'CONSENTED'|'REVIEWED'|'WITHDRAWN',now),attemptRecorded:await attempted(tx,value)};
}
async function unchanged(tx:Tx,value:DebiCheckBankConsent,identity:{organisationId:string;customerId:string;email:string;facilityId:string},now:Date){
 if(now<new Date(value.issuedAt)||now>=new Date(value.expiresAt))throw Error('DEBICHECK_BANK_CONSENT_EXPIRED');
 const source=await currentBankConsentSource(tx,scopeFor(identity.organisationId,identity.facilityId),identity,{accountId:value.source.accountId,requestId:value.source.requestId},now);
 if(cardSourceHash(source)!==cardSourceHash(value.source))throw Error('DEBICHECK_BANK_CONSENT_SOURCE_CHANGED');
 if(await attempted(tx,value))throw Error('DEBICHECK_BANK_CONSENT_ATTEMPT_EXISTS');
}
export async function previewTenantBankConsent(session:Tenant,input:{accountId:string;requestId:string},now=new Date()){
 enabled();return db.$transaction(async tx=>{
  const identity=await owner(tx,session,input.accountId),source=await currentBankConsentSource(tx,scopeFor(session.organisationId,identity.facilityId),identity,input,now);
  const preview=prepareBankAuthenticationConsent(source,now);
  if(await attempted(tx,preview))throw Error('DEBICHECK_BANK_CONSENT_ATTEMPT_EXISTS');
  return{preview,...projectBankAuthenticationConsent(preview,'PREVIEW',now)};
 },{isolationLevel:'RepeatableRead',timeout:20000});
}
/** Saves evidence only. These preparation audit actions deliberately cannot
 * satisfy the separate dispatch journal's bank-authentication authority. */
export async function saveTenantBankConsent(session:Tenant,input:{accountId:string;preview:unknown;accepted:boolean},now=new Date()){
 enabled();if(input.accepted!==true)throw Error('DEBICHECK_BANK_CONSENT_CONFIRMATION_REQUIRED');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${input.accountId} FOR UPDATE`;
  const identity=await owner(tx,session,input.accountId),preview=readBankAuthenticationConsent(input.preview,{id:(input.preview as {recordId?:string})?.recordId??'',accountId:input.accountId,...identity});
  if(preview.consentedAt!==null||preview.source.tenancyId!==identity.tenancyId)throw Error('DEBICHECK_BANK_CONSENT_STATE');
  const existing=await tx.configurationProfile.findUnique({where:{id:preview.recordId}});
  if(existing){
   const retained=read(existing,{...identity,accountId:input.accountId});
   if(cardSourceHash(retained.source)!==cardSourceHash(preview.source)||retained.issuedAt!==preview.issuedAt||retained.expiresAt!==preview.expiresAt)throw Error('DEBICHECK_BANK_CONSENT_INTEGRITY');
   // A duplicate save returns the retained state, including withdrawn/expired.
   return project(tx,retained,existing.status,now);
  }
  await unchanged(tx,preview,identity,now);
  const value=acceptBankAuthenticationConsent(preview,now);
  // An older active permission is withdrawn explicitly before preparing another.
  if(await tx.configurationProfile.count({where:{organisationId:session.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_BANK_CONSENT_DOMAIN,status:{in:['CONSENTED','REVIEWED']},config:{path:['requestId'],equals:value.source.requestId}}}))throw Error('DEBICHECK_BANK_CONSENT_EXISTS');
  await tx.configurationProfile.create({data:{id:value.recordId,organisationId:session.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_BANK_CONSENT_DOMAIN,name:value.recordId,status:'CONSENTED',config:encryptBankConsent(value)}});
  await tx.auditEvent.create({data:{occurredAt:now,organisationId:session.organisationId,facilityId:identity.facilityId,entityType:'ConfigurationProfile',entityId:value.recordId,action:'netcash.debicheck_bank_consent_saved',after:{accountId:input.accountId,customerId:identity.customerId,requestId:value.source.requestId,consentHash:bankAuthenticationConsentHash(value),consentedAt:value.consentedAt,providerActionPerformed:false,collectionEnabled:false,financialReceipt:false}}});
  return project(tx,value,'CONSENTED',now);
 },{isolationLevel:'Serializable',timeout:20000});
}
export async function withdrawTenantBankConsent(session:Tenant,input:{accountId:string;id:string},now=new Date()){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${input.accountId} FOR UPDATE`;
  const identity=await owner(tx,session,input.accountId),row=await tx.configurationProfile.findUnique({where:{id:input.id}});
  if(!row)throw Error('TENANT_NOT_FOUND');const value=read(row,{...identity,accountId:input.accountId});
  if(row.status==='WITHDRAWN')return project(tx,value,row.status,now);
  if(await attempted(tx,value))throw Error('DEBICHECK_PROVIDER_CANCELLATION_REVIEW');
  await tx.configurationProfile.update({where:{id:row.id},data:{status:'WITHDRAWN'}});
  await tx.auditEvent.create({data:{occurredAt:now,organisationId:session.organisationId,facilityId:identity.facilityId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_bank_consent_withdrawn',after:{accountId:input.accountId,customerId:identity.customerId,consentHash:bankAuthenticationConsentHash(value),providerActionPerformed:false,collectionEnabled:false}}});
  return project(tx,value,'WITHDRAWN',now);
 },{isolationLevel:'Serializable',timeout:20000});
}
export async function reviewBankConsent(scope:RequestScope,input:{accountId:string;id:string;confirmed:boolean},now=new Date()){
 enabled();if(input.confirmed!==true)throw Error('DEBICHECK_BANK_CONSENT_CONFIRMATION_REQUIRED');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id"=${input.accountId} FOR UPDATE`;
  const row=await tx.configurationProfile.findFirst({where:{id:input.id,organisationId:scope.organisationId,domain:DEBICHECK_BANK_CONSENT_DOMAIN}});
  if(!row?.facilityId||!scope.unrestrictedFacilities&&!scope.facilityIds.includes(row.facilityId))throw Error('FORBIDDEN');
  const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{where:{role:{organisationId:scope.organisationId}},include:{role:true}}}});
  if(!user||!currentRoleAccess(user.roleAssignments,'payments.view',row.facilityId).allowed||!currentRoleAccess(user.roleAssignments,'payments.bank_auth_review',row.facilityId).allowed)throw Error('FORBIDDEN');
  const account=await tx.account.findFirst({where:{id:input.accountId,customer:{organisationId:scope.organisationId,emailVerifiedAt:{not:null}},tenancy:{facilityId:row.facilityId,facility:{organisationId:scope.organisationId}}},select:{customer:{select:{id:true,email:true}},tenancy:{select:{id:true,customerId:true}}}});
  if(!account?.customer.email||!account.tenancy||account.customer.id!==account.tenancy.customerId||user.email.toLowerCase()===account.customer.email.toLowerCase())throw Error('DEBICHECK_INDEPENDENT_REVIEW_REQUIRED');
  const identity={organisationId:scope.organisationId,facilityId:row.facilityId,customerId:account.customer.id,email:account.customer.email,tenancyId:account.tenancy.id},value=read(row,{...identity,accountId:input.accountId});
  if(row.status!=='CONSENTED')throw Error('DEBICHECK_BANK_CONSENT_STATE');
  const audit=await tx.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId:row.facilityId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_bank_consent_saved',actorId:null},orderBy:{occurredAt:'asc'}});
  const evidence=audit?.after as Record<string,unknown>|null;
  if(!evidence||evidence.consentHash!==bankAuthenticationConsentHash(value)||evidence.customerId!==identity.customerId||evidence.consentedAt!==value.consentedAt||!audit||audit.occurredAt>now)throw Error('DEBICHECK_BANK_CONSENT_EVIDENCE');
  await unchanged(tx,value,identity,now);
  await tx.configurationProfile.update({where:{id:row.id},data:{status:'REVIEWED'}});
  await tx.auditEvent.create({data:{occurredAt:now,organisationId:scope.organisationId,facilityId:row.facilityId,actorId:scope.userId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_bank_consent_reviewed',after:{accountId:input.accountId,requestId:value.source.requestId,consentHash:bankAuthenticationConsentHash(value),providerActionPerformed:false,collectionEnabled:false,financialReceipt:false}}});
  return project(tx,value,'REVIEWED',now);
 },{isolationLevel:'Serializable',timeout:20000});
}

const cursorSchema=z.object({at:z.iso.datetime(),id:z.string().regex(/^debicheck-bank-consent:[a-f\d-]{36}$/)}).strict();
export async function listTenantBankConsents(session:Tenant,input:{accountId:string;cursor?:string},now=new Date()){
 let boundary:Prisma.ConfigurationProfileWhereInput={};
 if(input.cursor){
  let cursor:z.infer<typeof cursorSchema>;
  try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8')))}catch{throw Error('DEBICHECK_BANK_CONSENT_CURSOR')}
  boundary={OR:[{createdAt:{lt:new Date(cursor.at)}},{createdAt:new Date(cursor.at),id:{lt:cursor.id}}]};
 }
 return db.$transaction(async tx=>{
  const identity=await owner(tx,session,input.accountId);
  const rows=await tx.configurationProfile.findMany({where:{organisationId:session.organisationId,facilityId:identity.facilityId,domain:DEBICHECK_BANK_CONSENT_DOMAIN,config:{path:['accountId'],equals:input.accountId},...boundary},orderBy:[{createdAt:'desc'},{id:'desc'}],take:21});
  const last=rows[19];
  return{available:process.env.NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED==='true',nextCursor:rows.length>20?Buffer.from(JSON.stringify({at:last.createdAt.toISOString(),id:last.id})).toString('base64url'):null,records:await (async()=>{const records=[];for(const row of rows.slice(0,20))records.push(await project(tx,read(row,{...identity,accountId:input.accountId}),row.status,now));return records})()};
 },{isolationLevel:'RepeatableRead',timeout:20000});
}

export async function listStaffBankConsents(scope:RequestScope,input:{facilityId:string;cursor?:string},now=new Date()){
 let boundary:Prisma.ConfigurationProfileWhereInput={};
 if(input.cursor){let cursor:z.infer<typeof cursorSchema>;try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8')))}catch{throw Error('DEBICHECK_BANK_CONSENT_CURSOR')}boundary={OR:[{createdAt:{lt:new Date(cursor.at)}},{createdAt:new Date(cursor.at),id:{lt:cursor.id}}]}}
 return db.$transaction(async tx=>{
  if(!scope.unrestrictedFacilities&&!scope.facilityIds.includes(input.facilityId)||!await tx.facility.findFirst({where:{id:input.facilityId,organisationId:scope.organisationId},select:{id:true}}))throw Error('FORBIDDEN');
  const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{where:{role:{organisationId:scope.organisationId}},include:{role:true}}}});
  if(!user||!currentRoleAccess(user.roleAssignments,'payments.view',input.facilityId).allowed)throw Error('FORBIDDEN');
  const canReview=currentRoleAccess(user.roleAssignments,'payments.bank_auth_review',input.facilityId).allowed;
  const rows=await tx.configurationProfile.findMany({where:{organisationId:scope.organisationId,facilityId:input.facilityId,domain:DEBICHECK_BANK_CONSENT_DOMAIN,...boundary},orderBy:[{createdAt:'desc'},{id:'desc'}],take:21}),records=[];
  for(const row of rows.slice(0,20)){
   const metadata=row.config as {accountId?:unknown;customerId?:unknown}|null;
   if(typeof metadata?.accountId!=='string'||typeof metadata.customerId!=='string')throw Error('DEBICHECK_BANK_CONSENT_INTEGRITY');
   const account=await tx.account.findFirst({where:{id:metadata.accountId,customerId:metadata.customerId,customer:{organisationId:scope.organisationId},tenancy:{facilityId:input.facilityId}},select:{accountNumber:true,customer:{select:{email:true}},tenancy:{select:{id:true,customerId:true}}}});
   if(!account?.tenancy||account.tenancy.customerId!==metadata.customerId)throw Error('DEBICHECK_BANK_CONSENT_INTEGRITY');
   const value=read(row,{organisationId:scope.organisationId,facilityId:input.facilityId,accountId:metadata.accountId,customerId:metadata.customerId,tenancyId:account.tenancy.id}),record=await project(tx,value,row.status,now);
   records.push({...record,accountNumber:account.accountNumber,canReview:canReview&&process.env.NETCASH_DEBICHECK_BANK_CONSENT_PREPARATION_ENABLED==='true'&&row.status==='CONSENTED'&&!record.expired&&!record.attemptRecorded&&!!account.customer.email&&user.email.toLowerCase()!==account.customer.email.toLowerCase()});
  }
  const last=rows[19];return{records,nextCursor:rows.length>20?Buffer.from(JSON.stringify({at:last.createdAt.toISOString(),id:last.id})).toString('base64url'):null};
 },{isolationLevel:'RepeatableRead',timeout:20000});
}

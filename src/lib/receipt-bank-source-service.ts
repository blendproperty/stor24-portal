import {randomUUID} from 'node:crypto';
import type {Prisma,ReceiptBankSourceProfile} from '@/generated/prisma/client';
import {db} from './db';
import type {RequestScope} from './scope';
import {receiptImportAuthority} from './receipt-import-access';
import {bankSourceCreateSchema,bankSourceReviewSchema,prepareBankSourceIdentity,readBankSourceIdentity,privateBankSourceIdentity,receiptSourceHash} from './receipt-bank-source-policy';

type Client=Prisma.TransactionClient;
const sourcePermissions=['receipt_review.bank_sources','settlements.view'];
function project(row:ReceiptBankSourceProfile,userId:string){
 readBankSourceIdentity(row);
 return{id:row.id,label:row.label,bankCode:row.bankCode,accountSuffix:row.accountSuffix,currency:row.currency,status:row.status,revision:row.revision,requestReference:row.requestReference,reviewReference:row.reviewReference,requestedById:row.requestedById,reviewedById:row.reviewedById,reviewedAt:row.reviewedAt?.toISOString()??null,ownRequest:row.requestedById===userId,providerVerified:false as const};
}
async function serial<T>(scope:RequestScope,run:(client:Client)=>Promise<T>){
 return db.$transaction(async tx=>{
  await receiptImportAuthority(tx,scope,sourcePermissions);
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id"=${scope.organisationId} FOR UPDATE`;
  return run(tx);
 },{isolationLevel:'Serializable',timeout:20000});
}
async function sourceRow(client:Client,organisationId:string,id:string){
 const row=await client.receiptBankSourceProfile.findFirst({where:{id,organisationId}});
 if(!row)throw Error('RECEIPT_BANK_NOT_FOUND');
 const bank=privateBankSourceIdentity(row);
 const request=bankSourceCreateSchema.parse({...bank,label:row.label,requestKey:row.requestKey,reference:row.requestReference,confirmed:true});
 if(receiptSourceHash(request)!==row.requestHash)throw Error('RECEIPT_BANK_SOURCE_INTEGRITY');
 return row;
}
async function audit(client:Client,scope:RequestScope,row:ReceiptBankSourceProfile,action:string){
 await client.auditEvent.create({data:{organisationId:scope.organisationId,actorId:scope.userId,entityType:'ReceiptBankSourceProfile',entityId:row.id,action:'receipt_bank_source.'+action,after:{bankIdentityHash:row.bankIdentityHash,identitySignature:row.identitySignature,requestHash:row.requestHash,requestReference:row.requestReference,status:row.status,revision:row.revision,requestedById:row.requestedById,reviewReference:row.reviewReference,providerVerified:false,financialPosting:false}}});
}
export async function receiptBankSourceWorkspace(scope:RequestScope,cursor?:string){
 await receiptImportAuthority(db,scope,sourcePermissions);
 if(cursor&&!await db.receiptBankSourceProfile.findFirst({where:{id:cursor,organisationId:scope.organisationId},select:{id:true}}))throw Error('RECEIPT_BANK_NOT_FOUND');
 const rows=await db.receiptBankSourceProfile.findMany({where:{organisationId:scope.organisationId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:101,...(cursor?{cursor:{id:cursor},skip:1}:{})});
 return{rows:rows.slice(0,100).map(row=>project(row,scope.userId)),hasMore:rows.length>100,nextCursor:rows.length>100?rows[99].id:null};
}
export async function receiptBankSourcePrivateDetails(scope:RequestScope,id:string){
 return db.$transaction(async tx=>{
  await receiptImportAuthority(tx,scope,sourcePermissions);
  const row=await sourceRow(tx,scope.organisationId,id),bank=privateBankSourceIdentity(row);
  await audit(tx,scope,row,'private_details_read');
  return{source:project(row,scope.userId),bank};
 },{isolationLevel:'RepeatableRead'});
}
export async function createReceiptBankSource(scope:RequestScope,raw:unknown){
 const input=bankSourceCreateSchema.parse(raw),definition=prepareBankSourceIdentity(input,randomUUID(),scope.organisationId),requestHash=receiptSourceHash(input);
 return serial(scope,async tx=>{
  const retry=await tx.receiptBankSourceProfile.findUnique({where:{organisationId_requestKey:{organisationId:scope.organisationId,requestKey:input.requestKey}}});
  if(retry){await sourceRow(tx,scope.organisationId,retry.id);if(retry.requestHash!==requestHash||retry.requestedById!==scope.userId)throw Error('RECEIPT_BANK_CHANGED');return project(retry,scope.userId);}
  if(await tx.receiptBankSourceProfile.findUnique({where:{organisationId_bankIdentityHash:{organisationId:scope.organisationId,bankIdentityHash:definition.bankIdentityHash}}}))throw Error('RECEIPT_BANK_EXISTS');
  const row=await tx.receiptBankSourceProfile.create({data:{...definition,requestedById:scope.userId,requestKey:input.requestKey,requestHash,requestReference:input.reference,status:'PENDING_REVIEW'}});
  await audit(tx,scope,row,'requested');return project(row,scope.userId);
 });
}
export async function reviewReceiptBankSource(scope:RequestScope,raw:unknown){
 const input=bankSourceReviewSchema.parse(raw);
 return serial(scope,async tx=>{
  const row=await sourceRow(tx,scope.organisationId,input.id);
  if(input.action==='request-review'&&row.status==='PENDING_REVIEW'&&row.requestKey===input.requestKey&&row.requestReference===input.reference&&row.requestedById===scope.userId)return project(row,scope.userId);
  if(row.revision!==input.revision)throw Error('RECEIPT_BANK_CHANGED');
  if(['approve','reject'].includes(input.action)&&row.requestedById===scope.userId)throw Error('RECEIPT_BANK_INDEPENDENT');
  let data:Prisma.ReceiptBankSourceProfileUpdateInput;
  if(input.action==='request-review'){
   if(!['WITHDRAWN','REJECTED','REVOKED'].includes(row.status)||!input.requestKey)throw Error('RECEIPT_BANK_STATE');
   const bank=privateBankSourceIdentity(row),request=bankSourceCreateSchema.parse({...bank,label:row.label,requestKey:input.requestKey,reference:input.reference,confirmed:true});
   data={status:'PENDING_REVIEW',revision:{increment:1},requestedById:scope.userId,requestKey:input.requestKey,requestHash:receiptSourceHash(request),requestReference:input.reference,reviewedById:null,reviewedAt:null,reviewReference:null};
  }else{
   if(input.action==='revoke'?row.status!=='APPROVED':row.status!=='PENDING_REVIEW')throw Error('RECEIPT_BANK_STATE');
   if(input.action==='withdraw'&&row.requestedById!==scope.userId)throw Error('FORBIDDEN');
   const status={approve:'APPROVED',reject:'REJECTED',withdraw:'WITHDRAWN',revoke:'REVOKED'}[input.action];
   data={status,revision:{increment:1},reviewedById:scope.userId,reviewedAt:new Date(),reviewReference:input.reference};
  }
  const updated=await tx.receiptBankSourceProfile.update({where:{id:row.id},data});
  await audit(tx,scope,updated,input.action==='request-review'?'requested':{approve:'approved',reject:'rejected',withdraw:'withdrawn',revoke:'revoked'}[input.action]);
  return project(updated,scope.userId);
 });
}
/** Internal import/post dependency. It proves retained independent finance
 * approval of a stable source identity; it never verifies a bank or collects. */
export async function approvedReceiptBankSource(client:Client,organisationId:string,id:string){
 const row=await sourceRow(client,organisationId,id);
 if(row.status!=='APPROVED'||!row.reviewedById||row.reviewedById===row.requestedById||!row.reviewedAt||!row.reviewReference)throw Error('RECEIPT_BANK_APPROVAL_REQUIRED');
 const event=await client.auditEvent.findFirst({where:{organisationId,entityType:'ReceiptBankSourceProfile',entityId:id,action:'receipt_bank_source.approved',actorId:row.reviewedById},orderBy:{occurredAt:'desc'}});
 const evidence=event?.after as Record<string,unknown>|null;
 if(!evidence||evidence.bankIdentityHash!==row.bankIdentityHash||evidence.identitySignature!==row.identitySignature||evidence.requestHash!==row.requestHash||evidence.revision!==row.revision||evidence.reviewReference!==row.reviewReference||evidence.status!=='APPROVED')throw Error('RECEIPT_BANK_APPROVAL_REQUIRED');
 return{...row,approvalAuditId:event!.id};
}

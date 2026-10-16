import {z} from 'zod';
import type {Prisma} from '@/generated/prisma/client';
import {db} from '@/lib/db';
import type {RequestScope} from '@/lib/scope';
import {currentRoleAccess} from '@/lib/current-role-access';
import {DEBICHECK_REQUEST_DOMAIN,readDebiCheckRequest} from './netcash-debicheck-request-policy';
import {DEBICHECK_ATTEMPT_DOMAIN,DEBICHECK_STATUS_OBSERVATION_DOMAIN,readDebiCheckAttempt,projectDebiCheckAttempt,readDebiCheckStatusObservation} from './netcash-debicheck-attempt-policy';
import {debiCheckHistoryQuery,debiCheckHistorySnapshot} from './netcash-debicheck-history-policy';

type Tx=Prisma.TransactionClient;
const cursor=z.object({at:z.iso.datetime(),id:z.string().min(1).max(250)}).strict();
function boundary(raw:string|undefined,prefix:string){
 if(!raw)return{};
 let value:z.infer<typeof cursor>;
 try{value=cursor.parse(JSON.parse(Buffer.from(raw,'base64url').toString('utf8')))}catch{throw Error('DEBICHECK_HISTORY_QUERY')}
 if(!value.id.startsWith(prefix))throw Error('DEBICHECK_HISTORY_CURSOR');
 return{OR:[{createdAt:{lt:new Date(value.at)}},{createdAt:new Date(value.at),id:{lt:value.id}}]};
}
const next=(rows:{createdAt:Date;id:string}[])=>rows.length>20?Buffer.from(JSON.stringify({at:rows[19].createdAt.toISOString(),id:rows[19].id})).toString('base64url'):null;
async function authority(tx:Tx,scope:RequestScope,facilityId:string){
 if(!scope.unrestrictedFacilities&&!scope.facilityIds.includes(facilityId))throw Error('FORBIDDEN');
 const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
 if(!user||!currentRoleAccess(user.roleAssignments,'payments.view',facilityId).allowed||!await tx.facility.findFirst({where:{id:facilityId,organisationId:scope.organisationId},select:{id:true}}))throw Error('FORBIDDEN');
}
/** Reads retained, sealed evidence only. Never calls a provider, prepares a
 * dispatch, changes an outcome, grants access or infers received money. */
export async function readDebiCheckHistory(incoming:RequestScope,raw:unknown){
 const query=debiCheckHistoryQuery.parse(raw);
 return db.$transaction(async tx=>{
  await authority(tx,incoming,query.facilityId);
  const where={organisationId:incoming.organisationId,facilityId:query.facilityId,domain:DEBICHECK_ATTEMPT_DOMAIN};
  const rows=await tx.configurationProfile.findMany({where:{...where,...(query.status?{status:query.status}:{}),...boundary(query.cursor,'debicheck-attempt:')},orderBy:[{createdAt:'desc'},{id:'desc'}],take:21});
  async function hydrate(row:typeof rows[number]){
   const request=await tx.configurationProfile.findFirst({where:{id:row.name,organisationId:incoming.organisationId,facilityId:query.facilityId,domain:DEBICHECK_REQUEST_DOMAIN}});
   const accountId=(request?.config as {accountId?:unknown}|null)?.accountId;
   if(!request||typeof accountId!=='string')throw Error('DEBICHECK_HISTORY_INTEGRITY');
   const definition=readDebiCheckRequest(request.config,{id:request.id,organisationId:incoming.organisationId,facilityId:query.facilityId,accountId});
   const attempt=readDebiCheckAttempt(row.config,{id:row.id,organisationId:incoming.organisationId,facilityId:query.facilityId,accountId}),source=attempt.source,projection=projectDebiCheckAttempt(attempt);
   if(row.domain!==DEBICHECK_ATTEMPT_DOMAIN||row.status!==projection.status||row.name!==source.requestId||definition.signature!==source.requestSignature||definition.sourceHash!==source.sourceHash||definition.merchantHash!==source.merchantHash||definition.templateSourceHash!==source.templateSourceHash||definition.connectionId!==source.connectionId||definition.connectionUpdatedAt!==source.connectionUpdatedAt)throw Error('DEBICHECK_HISTORY_INTEGRITY');
   const account=await tx.account.findFirst({where:{id:accountId,customerId:definition.customerId,customer:{organisationId:incoming.organisationId},tenancy:{id:definition.tenancyId,facilityId:query.facilityId}},select:{accountNumber:true}});
   if(!account)throw Error('DEBICHECK_HISTORY_ACCOUNT');
   return{attempt,view:{...projection,accountNumber:account.accountNumber,bankSuffix:definition.bankSuffix,monthlyAmount:definition.monthlyAmount,startDate:definition.startDate}};
  }
  const attempts=[];
  for(const row of rows.slice(0,20))attempts.push((await hydrate(row)).view);
  const selectedRow=query.attemptId?await tx.configurationProfile.findFirst({where:{...where,id:query.attemptId}}):null;
  if(query.attemptId&&!selectedRow)throw Error('DEBICHECK_HISTORY_NOT_FOUND');
  const selected=selectedRow?await hydrate(selectedRow):null;
  if(query.observationCursor&&!selected)throw Error('DEBICHECK_HISTORY_CURSOR');
  const observations=selected?await tx.configurationProfile.findMany({where:{organisationId:incoming.organisationId,facilityId:query.facilityId,domain:DEBICHECK_STATUS_OBSERVATION_DOMAIN,id:{startsWith:selected.attempt.recordId+':status:'},...boundary(query.observationCursor,selected.attempt.recordId+':status:')},orderBy:[{createdAt:'desc'},{id:'desc'}],take:21}):[];
  const history=observations.slice(0,20).map(row=>{
   const projection=readDebiCheckStatusObservation(row.config,selected!.attempt,selected!.attempt.source.merchantHash);
   if(row.id!==projection.id||row.name!==row.id||row.status!=='OBSERVED')throw Error('DEBICHECK_HISTORY_INTEGRITY');
   return projection;
  });
  return debiCheckHistorySnapshot.parse({facilityId:query.facilityId,attempts,nextCursor:next(rows),selected:selected?.view??null,observations:history,nextObservationCursor:next(observations),providerQueried:false});
 },{isolationLevel:'RepeatableRead',timeout:20000}).catch(error=>{if(error instanceof z.ZodError)throw Error('DEBICHECK_HISTORY_INTEGRITY');throw error});
}

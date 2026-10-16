import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {db} from '@/lib/db';
import type {Prisma} from '@/generated/prisma/client';
import {requireFacility,type RequestScope,type FacilityScope} from '@/lib/scope';
import {getNetcashConnection} from './netcash-client';
import {merchantIdentity} from './netcash-statement';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import {readDebiCheckTemplate} from './netcash-debicheck-soap';

export const DEBICHECK_TEMPLATE_DOMAIN='NETCASH_DEBICHECK_TEMPLATE';
const observationSchema=z.object({version:z.literal(1),recordId:z.string().regex(/^debicheck-template:[a-f\d-]{36}$/),organisationId:z.string(),facilityId:z.string(),connectionId:z.string(),connectionUpdatedAt:z.iso.datetime(),merchantHash:z.string().regex(/^[a-f\d]{64}$/),environment:z.literal('sandbox'),requestedBy:z.string(),checkedAt:z.iso.datetime(),templateId:z.string().regex(/^NCDCT\d{9}$/),sourceHash:z.string().regex(/^[a-f\d]{64}$/),signature:z.string().regex(/^[a-f\d]{64}$/),snapshot:z.object({templateId:z.string(),detail:z.record(z.string(),z.string().nullable()),monthlyDayOptions:z.array(z.string()).min(1).max(62),authenticationSubmissionEnabled:z.literal(false),collectionEnabled:z.literal(false)}).strict()}).strict();
type Observation=z.infer<typeof observationSchema>;
function signature(value:object){const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('DEBICHECK_SIGNING_REQUIRED');return createHmac('sha256',key).update('netcash-debicheck-template:v1:'+cardSourceHash(value)).digest('hex');}
function readObservation(value:unknown,scope:FacilityScope,recordId:string){
 const observation=observationSchema.parse(value),{signature:stored,...plain}=observation;
 if(observation.recordId!==recordId||observation.organisationId!==scope.organisationId||observation.snapshot.templateId!==observation.templateId||cardSourceHash(observation.snapshot)!==observation.sourceHash||!timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(signature(plain),'hex')))throw Error('DEBICHECK_TEMPLATE_INTEGRITY_REVIEW');
 return observation;
}
async function connection(scope:FacilityScope,facilityId:string,client:Prisma.TransactionClient=db){
 if(!scope.unrestrictedFacilities&&!scope.facilityIds.includes(facilityId)||!await client.facility.findFirst({where:{id:facilityId,organisationId:scope.organisationId}}))throw Error('FACILITY_FORBIDDEN');
 const value=await getNetcashConnection(scope.organisationId,facilityId,true,client),stored=await client.integrationConnection.findUniqueOrThrow({where:{id:value.id}});
 if((stored.config as {environment?:unknown}).environment!=='test'||value.config.environment!=='sandbox'||!value.config.debitOrderServiceKey||!value.config.merchantAccount||!['CONNECTED','HEALTHY'].includes(value.status))throw Error('DEBICHECK_TEST_CONFIGURATION_REQUIRED');
 return value;
}
function connectionMatches(observation:Observation,value:Awaited<ReturnType<typeof connection>>){return observation.connectionId===value.id&&observation.connectionUpdatedAt===value.updatedAt.toISOString()&&observation.merchantHash===merchantIdentity(observation.organisationId,'sandbox',value.config.merchantAccount!);}
export async function observeDebiCheckTemplate(scope:RequestScope,input:{facilityId:string;templateId:string},request:typeof fetch=fetch,now=new Date()){
 if(!/^NCDCT\d{9}$/.test(input.templateId))throw Error('DEBICHECK_TEMPLATE_INVALID');
 const c=await connection(scope,input.facilityId),snapshot=await readDebiCheckTemplate(c.config.debitOrderServiceKey!,input.templateId,request);
 const id='debicheck-template:'+randomUUID();
 const plain={version:1 as const,recordId:id,organisationId:scope.organisationId,facilityId:input.facilityId,connectionId:c.id,connectionUpdatedAt:c.updatedAt.toISOString(),merchantHash:merchantIdentity(scope.organisationId,'sandbox',c.config.merchantAccount!),environment:'sandbox' as const,requestedBy:scope.userId,checkedAt:now.toISOString(),templateId:input.templateId,sourceHash:cardSourceHash(snapshot),snapshot};
 const observation={...plain,signature:signature(plain)};
 await db.$transaction(async tx=>{
  const current=await tx.integrationConnection.findUniqueOrThrow({where:{id:c.id}});if(current.updatedAt.getTime()!==c.updatedAt.getTime())throw Error('DEBICHECK_CONFIGURATION_CHANGED');
  await tx.configurationProfile.create({data:{id,organisationId:scope.organisationId,facilityId:input.facilityId,domain:DEBICHECK_TEMPLATE_DOMAIN,name:id,status:'PENDING_REVIEW',config:observation}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:input.facilityId,actorId:scope.userId,action:'netcash.debicheck_template_observed',entityType:'ConfigurationProfile',entityId:id,after:{templateId:input.templateId,sourceHash:plain.sourceHash,providerMutation:false,authenticationEnabled:false,collectionEnabled:false}}});
 },{isolationLevel:'Serializable'});
 return{id,status:'PENDING_REVIEW',...observation.snapshot,checkedAt:observation.checkedAt,ownRequest:true};
}
export async function reviewDebiCheckTemplate(scope:RequestScope,input:{id:string;confirmed:boolean},request:typeof fetch=fetch,now=new Date()){
 if(input.confirmed!==true)throw Error('DEBICHECK_REVIEW_CONFIRMATION_REQUIRED');
 const row=await db.configurationProfile.findFirst({where:{id:input.id,organisationId:scope.organisationId,domain:DEBICHECK_TEMPLATE_DOMAIN}});if(!row?.facilityId)throw Error('DEBICHECK_TEMPLATE_NOT_FOUND');
 await requireFacility(scope,row.facilityId);const observation=readObservation(row.config,scope,row.id);
 if(observation.facilityId!==row.facilityId||row.id!==row.name||observation.requestedBy===scope.userId)throw Error('DEBICHECK_INDEPENDENT_REVIEW_REQUIRED');
 if(row.status!=='PENDING_REVIEW'||new Date(observation.checkedAt).getTime()>now.getTime()||now.getTime()-new Date(observation.checkedAt).getTime()>900000)throw Error('DEBICHECK_TEMPLATE_REVIEW_EXPIRED');
 const c=await connection(scope,row.facilityId);if(!connectionMatches(observation,c))throw Error('DEBICHECK_CONFIGURATION_CHANGED');
 const snapshot=await readDebiCheckTemplate(c.config.debitOrderServiceKey!,observation.templateId,request);if(cardSourceHash(snapshot)!==observation.sourceHash)throw Error('DEBICHECK_TEMPLATE_SOURCE_CHANGED');
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "ConfigurationProfile" WHERE "id"=${row.id} FOR UPDATE`;
  const current=await tx.configurationProfile.findUniqueOrThrow({where:{id:row.id}}),configuration=await tx.integrationConnection.findUniqueOrThrow({where:{id:c.id}});
  if(current.status!=='PENDING_REVIEW'||current.updatedAt.getTime()!==row.updatedAt.getTime()||configuration.updatedAt.getTime()!==c.updatedAt.getTime())throw Error('DEBICHECK_TEMPLATE_SOURCE_CHANGED');
  readObservation(current.config,scope,current.id);
  await tx.configurationProfile.update({where:{id:row.id},data:{status:'REVIEWED'}});
  await tx.auditEvent.create({data:{organisationId:scope.organisationId,facilityId:row.facilityId,actorId:scope.userId,action:'netcash.debicheck_template_reviewed',entityType:'ConfigurationProfile',entityId:row.id,after:{sourceHash:observation.sourceHash,providerMutation:false,authenticationEnabled:false,collectionEnabled:false}}});
 },{isolationLevel:'Serializable'});
 return{id:row.id,status:'REVIEWED',authenticationSubmissionEnabled:false,collectionEnabled:false};
}
export async function listDebiCheckTemplates(scope:RequestScope,facilityId:string){
 await requireFacility(scope,facilityId);
 const rows=await db.configurationProfile.findMany({where:{organisationId:scope.organisationId,facilityId,domain:DEBICHECK_TEMPLATE_DOMAIN},orderBy:{createdAt:'desc'},take:21});
 let c:Awaited<ReturnType<typeof connection>>|null=null;
 try{c=await connection(scope,facilityId)}catch(error){if(!(error instanceof Error)||!['DEBICHECK_TEST_CONFIGURATION_REQUIRED','NETCASH_NOT_CONFIGURED'].includes(error.message))throw error;}
 return{hasMore:rows.length>20,records:rows.slice(0,20).map(row=>{const observation=readObservation(row.config,scope,row.id);if(observation.facilityId!==facilityId||row.id!==row.name)throw Error('DEBICHECK_TEMPLATE_INTEGRITY_REVIEW');return{id:row.id,status:row.status,...observation.snapshot,checkedAt:observation.checkedAt,ownRequest:observation.requestedBy===scope.userId,sourceCurrent:c!==null&&connectionMatches(observation,c)}})};
}
/** Internal preparation dependency. A reviewed template is evidence for review,
 * never permission to submit TT1 or to collect. Recheck its original identity,
 * independent review audit and current merchant connection before using it. */
export async function reviewedDebiCheckTemplate(scope:FacilityScope,facilityId:string,id:string,now=new Date(),client:Prisma.TransactionClient=db){
 if(!scope.unrestrictedFacilities&&!scope.facilityIds.includes(facilityId)||!await client.facility.findFirst({where:{id:facilityId,organisationId:scope.organisationId}}))throw Error('FACILITY_FORBIDDEN');
 const row=await client.configurationProfile.findFirst({where:{id,organisationId:scope.organisationId,facilityId,domain:DEBICHECK_TEMPLATE_DOMAIN,status:'REVIEWED'}});
 if(!row)throw Error('DEBICHECK_REVIEWED_TEMPLATE_REQUIRED');
 const observation=readObservation(row.config,scope,row.id);
 if(row.id!==row.name||observation.facilityId!==facilityId||new Date(observation.checkedAt)>now||now.getTime()-new Date(observation.checkedAt).getTime()>900000)throw Error('DEBICHECK_TEMPLATE_REVIEW_EXPIRED');
 const review=await client.auditEvent.findFirst({where:{organisationId:scope.organisationId,facilityId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_template_reviewed'},orderBy:{occurredAt:'desc'}});
 if(!review?.actorId||review.actorId===observation.requestedBy||(review.after as {sourceHash?:unknown}|null)?.sourceHash!==observation.sourceHash)throw Error('DEBICHECK_INDEPENDENT_REVIEW_REQUIRED');
 const c=await connection(scope,facilityId,client);if(!connectionMatches(observation,c))throw Error('DEBICHECK_CONFIGURATION_CHANGED');
 return{observationId:row.id,templateId:observation.templateId,sourceHash:observation.sourceHash,connectionId:c.id,connectionUpdatedAt:c.updatedAt.toISOString(),merchantHash:observation.merchantHash,monthlyDayOptions:observation.snapshot.monthlyDayOptions,snapshot:observation.snapshot,authenticationSubmissionEnabled:false as const,collectionEnabled:false as const};
}

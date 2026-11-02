import {createHash,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {db} from './db';
import {encryptIntegrationSecret,decryptIntegrationSecret} from './integrations/integration-secret-vault';
import {metaConversionConsent} from './meta-conversion-contract';
import {deliverMetaLead,META_DATASET,type MetaLeadEvent} from './meta-conversion-delivery';

const domain='META_CONVERSIONS',destination=`meta://${META_DATASET}`;
const maxAge=6*24*60*60*1000;
export async function queueSavedMetaLead(id:string|null,consent:unknown,ip:string,userAgent:string|null,reservation=false,allowCreate=true){
  if(!id||!metaConversionConsent.safeParse(consent).success)return undefined;
  try{
    const booking=reservation?await db.reservation.findUnique({where:{publicReference:id},select:{leadId:true,status:true,source:true}}):null;
    if(reservation&&(!booking||booking.status!=='ACTIVE'||booking.source==='PUBLIC_WALK_IN'))return undefined;
    const lead=await db.lead.findUnique({where:{id:booking?.leadId??id},select:{id:true,facilityId:true,facility:{select:{organisationId:true}}}});
    if(!lead||lead.facility.organisationId!==process.env.ADVERTISING_ORGANISATION_ID)return undefined;
    // Idempotent acknowledgements share the ID even if the first request is still queueing.
    // They never create a new server event or backfill an older booking.
    if(!allowCreate)return createHash("sha256").update(`stor24:meta:Lead:${lead.facility.organisationId}:${lead.id}`).digest("hex");
    return await queueMetaLead(lead.facility.organisationId,lead.facilityId,lead.id,consent,ip,userAgent);
  }catch{return undefined;}
}
async function configuration(organisationId:string,client=db){return client.configurationProfile.findFirst({where:{organisationId,facilityId:null,domain,name:'website'}});}
export async function metaConversionStatus(organisationId:string){
  const row=await configuration(organisationId);
  const counts=await db.webhookOutbox.groupBy({by:['status'],where:{organisationId,destination},_count:true});
  return {configured:!!row,enabled:row?.status==='READY',dataset:META_DATASET,counts:counts.map(r=>({status:r.status,count:r._count}))};
}
export async function configureMetaConversions(organisationId:string,actorId:string,token:string,testEventCode:string){
  // Test Events explicitly excludes the probe from attributed/optimisation results.
  const event:MetaLeadEvent={event_name:'Lead',event_time:Math.floor(Date.now()/1000),event_id:`stor24-connection-test-${randomUUID()}`,action_source:'website',event_source_url:'https://stor24.co.za/',user_data:{fbp:`fb.1.${Date.now()}.1`}};
  const result=await deliverMetaLead(token,event,testEventCode);
  if(result.status!=='accepted')return false;
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id"=${organisationId} FOR UPDATE`;
    const row=await tx.configurationProfile.findFirst({where:{organisationId,facilityId:null,domain,name:'website'}});
    const data={status:'READY',config:{dataset:META_DATASET,encryptedToken:encryptIntegrationSecret(token)}};
    if(row)await tx.configurationProfile.update({where:{id:row.id},data});
    else await tx.configurationProfile.create({data:{organisationId,domain,name:'website',...data}});
    await tx.auditEvent.create({data:{organisationId,actorId,action:'marketing.meta_conversions.verified',entityType:'Organisation',entityId:organisationId,after:{dataset:META_DATASET,testEventAccepted:true,enabled:true}}});
  });return true;
}
export async function disableMetaConversions(organisationId:string,actorId:string){
  await db.$transaction(async tx=>{
    await tx.configurationProfile.updateMany({where:{organisationId,domain,name:'website'},data:{status:'DISABLED',config:{dataset:META_DATASET}}});
    await tx.webhookOutbox.updateMany({where:{organisationId,destination,status:{in:['PENDING','FAILED','PROCESSING']}},data:{status:'DEAD_LETTER',payload:{},failureCode:'DISABLED'}});
    await tx.auditEvent.create({data:{organisationId,actorId,action:'marketing.meta_conversions.disabled',entityType:'Organisation',entityId:organisationId}});
  });
}
// Called only after a successful public CRM save. Failure never loses the enquiry.
export async function queueMetaLead(organisationId:string,facilityId:string,leadId:string,consent:unknown,ip:string,userAgent:string|null){
  const parsed=metaConversionConsent.safeParse(consent);
  if(!parsed.success||organisationId!==process.env.ADVERTISING_ORGANISATION_ID)return undefined;
  try{
    const config=await configuration(organisationId);if(config?.status!=='READY')return undefined;
    const eventId=createHash('sha256').update(`stor24:meta:Lead:${organisationId}:${leadId}`).digest('hex');
    const event:MetaLeadEvent={event_name:'Lead',event_time:Math.floor(Date.now()/1000),event_id:eventId,action_source:'website',event_source_url:`https://stor24.co.za${parsed.data.page}`,user_data:{fbp:parsed.data.fbp,...(parsed.data.fbc?{fbc:parsed.data.fbc}:{}),...(isIP(ip)?{client_ip_address:ip}:{}),...(userAgent&&userAgent.length<=512?{client_user_agent:userAgent}:{})}};
    await db.webhookOutbox.upsert({where:{idempotencyKey:`meta:Lead:${eventId}`},update:{},create:{organisationId,facilityId,eventType:'marketing.meta.Lead',aggregateType:'Lead',aggregateId:leadId,destination,idempotencyKey:`meta:Lead:${eventId}`,payload:{consentVersion:parsed.data.version,encryptedEvent:encryptIntegrationSecret(JSON.stringify(event))},nextAttemptAt:new Date()}});
    return eventId;
  }catch{return undefined;}
}
export async function processMetaConversions(client=db){
  const organisationId=process.env.ADVERTISING_ORGANISATION_ID;if(!organisationId)return {accepted:0,failed:0};
  const row=await configuration(organisationId,client);if(row?.status!=='READY')return {accepted:0,failed:0};
  const config=row.config as {encryptedToken:string};let accepted=0,failed=0;
  // Expire matching payloads, including previously accepted events. No historical backfill.
  await client.webhookOutbox.updateMany({where:{organisationId,destination,status:{in:["PENDING","PROCESSING","FAILED"]},createdAt:{lt:new Date(Date.now()-maxAge)}},data:{payload:{},status:'DEAD_LETTER',failureCode:'EXPIRED'}});
  const due=await client.webhookOutbox.findMany({where:{organisationId,destination,createdAt:{gte:new Date(Date.now()-maxAge)},OR:[{status:{in:['PENDING','FAILED']},nextAttemptAt:{lte:new Date()}},{status:'PROCESSING',nextAttemptAt:{lte:new Date()}}]},orderBy:{createdAt:'asc'},take:10});
  for(const job of due){
    const lease=new Date(Date.now()+60_000);
    const claim=await client.webhookOutbox.updateMany({where:{id:job.id,status:job.status,attempts:job.attempts,nextAttemptAt:job.nextAttemptAt},data:{status:'PROCESSING',attempts:{increment:1},nextAttemptAt:lease}});
    if(claim.count!==1)continue;
    try{
      // Respect a revoked connection before every outbound request.
      if((await configuration(organisationId,client))?.status!=='READY')continue;
      const event=JSON.parse(decryptIntegrationSecret((job.payload as {encryptedEvent:string}).encryptedEvent)) as MetaLeadEvent;
      const result=await deliverMetaLead(decryptIntegrationSecret(config.encryptedToken),event);
      const success=result.status==='accepted',terminal=result.status==='rejected'||job.attempts>=9;
      await client.webhookOutbox.updateMany({where:{id:job.id,status:'PROCESSING',nextAttemptAt:lease},data:{status:success?'SUCCEEDED':terminal?'DEAD_LETTER':'FAILED',responseStatus:result.http||null,deliveredAt:success?new Date():null,failureCode:success?null:terminal?'PROVIDER_REJECTED':'RETRY_PENDING',nextAttemptAt:success||terminal?null:new Date(Date.now()+Math.min(3600_000,60_000*2**job.attempts)),...(success||terminal?{payload:{}}:{})}});
      if(success)accepted++;else failed++;
    }catch{failed++;await client.webhookOutbox.updateMany({where:{id:job.id,status:'PROCESSING',nextAttemptAt:lease},data:{status:'DEAD_LETTER',payload:{},failureCode:'INVALID_DELIVERY_CONFIG',nextAttemptAt:null}});}
  }return {accepted,failed};
}

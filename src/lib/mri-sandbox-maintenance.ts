import {createHash,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {z} from 'zod';
import {databaseConfig} from './database-limits';
import {decryptIntegrationSecret,encryptIntegrationSecret} from './integrations/integration-secret-vault';
import {verifyMriAccess} from './integrations/mri-provider';

const TARGET='BlendTest';
export const mriSandboxMaintenanceSchema=z.object({organisationId:z.string().cuid(),primaryRevision:z.iso.datetime(),maintenanceReference:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 .:_-]{7,99}$/)}).strict();
const storedSchema=z.object({version:z.literal(1),loginEncrypted:z.string().min(1),passwordEncrypted:z.string().min(1),databaseIdentifierEncrypted:z.string().optional()}).passthrough();
type Connection={id:string;config:unknown;updatedAt:Date;provider:string};
const hash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function client(){return new Client({...databaseConfig(process.env.DATABASE_URL),application_name:'stor24-mri-sandbox-maintenance'});}
async function connections(c:Client,organisationId:string,lock=false){return(await c.query<Connection>('SELECT id,config,"updatedAt",provider FROM "IntegrationConnection" WHERE "organisationId"=$1 AND "facilityId" IS NULL AND category=$2 AND provider=ANY($3::text[]) ORDER BY provider,id'+(lock?' FOR UPDATE':''),[organisationId,'ACCOUNTING',['MRI','MRI_SANDBOX']])).rows;}

/** Operator-only configuration repair for an already authorised stored account.
 * No web endpoint, human-session impersonation, primary update or journal call.
 * Default preview performs only database/provider reads. Apply is create-only,
 * revision-bound, atomic with a null-human SYSTEM_MAINTENANCE audit, and off. */
export async function prepareMriSandboxMaintenance(value:unknown,options:{apply?:boolean;fetcher?:typeof fetch}={}){
 const input=mriSandboxMaintenanceSchema.parse(value),apply=options.apply===true;
 if(apply&&process.env.MRI_SANDBOX_MAINTENANCE_ENABLED!=='true')throw Error('MRI_SANDBOX_MAINTENANCE_DISABLED');
 const read=client();await read.connect();let rows:Connection[];
 try{await read.query('BEGIN READ ONLY');rows=await connections(read,input.organisationId);await read.query('ROLLBACK');}finally{await read.end()}
 const primary=rows.filter(r=>r.provider==='MRI'),sandbox=rows.filter(r=>r.provider==='MRI_SANDBOX');
 if(primary.length!==1||sandbox.length>1)throw Error('MRI_DUPLICATE_OR_MISSING_CONFIG');
 if(sandbox.length)throw Error('MRI_SANDBOX_ALREADY_CONFIGURED');
 const source=primary[0];if(source.updatedAt.toISOString()!==input.primaryRevision)throw Error('MRI_CHANGED');
 const config=storedSchema.parse(source.config),login=decryptIntegrationSecret(config.loginEncrypted),password=decryptIntegrationSecret(config.passwordEncrypted);
 const discovered=await verifyMriAccess({login,password},options.fetcher),matches=discovered.databases.filter(d=>d.DatabaseName===TARGET);
 if(!discovered.discoveryAvailable||matches.length!==1)throw Error('MRI_SANDBOX_TARGET');
 const identifier=matches[0].DatabaseIdentifier;
 if(config.databaseIdentifierEncrypted&&decryptIntegrationSecret(config.databaseIdentifierEncrypted)===identifier)throw Error('MRI_SANDBOX_SHARED_TARGET');
 const verified=await verifyMriAccess({login,password,databaseIdentifier:identifier,expectedDatabaseLabel:TARGET},options.fetcher);
 if(!verified.authenticated||!verified.databaseReadable||!verified.discoveryAvailable||verified.propertyCount===null)throw Error('MRI_SANDBOX_READ_REQUIRED');
 const summary={target:TARGET,authenticated:verified.authenticated,databaseReadable:verified.databaseReadable,propertyCount:verified.propertyCount,postingEnabled:false as const,journalSubmitted:false as const,primaryChanged:false as const};
 if(!apply)return{mode:'preview' as const,created:false,...summary};
 const id='mri-sandbox:'+input.organisationId,now=new Date();
 const saved={version:1,environment:'test',databaseLabel:TARGET,loginEncrypted:encryptIntegrationSecret(login),passwordEncrypted:encryptIntegrationSecret(password),databaseIdentifierEncrypted:encryptIntegrationSecret(identifier),authenticated:verified.authenticated,databaseReadable:verified.databaseReadable,discoveryAvailable:verified.discoveryAvailable,propertyCount:verified.propertyCount,databases:verified.databases.map(d=>({key:randomUUID(),label:d.DatabaseName,identifierEncrypted:encryptIntegrationSecret(d.DatabaseIdentifier)}))};
 const write=client();await write.connect();
 try{
  await write.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  const org=await write.query('SELECT id FROM "Organisation" WHERE id=$1 FOR UPDATE',[input.organisationId]);if(org.rowCount!==1)throw Error('MRI_ORGANISATION_REQUIRED');
  const current=await connections(write,input.organisationId,true),p=current.filter(r=>r.provider==='MRI');
  if(current.some(r=>r.provider==='MRI_SANDBOX'))throw Error('MRI_SANDBOX_ALREADY_CONFIGURED');
  if(p.length!==1||p[0].id!==source.id||p[0].updatedAt.toISOString()!==input.primaryRevision||hash(p[0].config)!==hash(source.config))throw Error('MRI_CHANGED');
  await write.query('INSERT INTO "IntegrationConnection" (id,"organisationId","facilityId",category,provider,status,config,"lastHealthAt","lastSuccessAt","consecutiveFailures","failureCode","createdAt","updatedAt") VALUES ($1,$2,NULL,\'ACCOUNTING\',\'MRI_SANDBOX\',\'CONFIGURED\',$3::jsonb,$4,$4,0,\'MRI_JOURNAL_NOT_ENABLED\',$4,$4)',[id,input.organisationId,JSON.stringify(saved),now]);
  await write.query('INSERT INTO "AuditEvent" (id,"organisationId","actorId",action,"entityType","entityId",after,"occurredAt") VALUES ($1,$2,NULL,\'integration.mri.sandbox.prepared_by_maintenance\',\'IntegrationConnection\',$3,$4::jsonb,$5)',[randomUUID(),input.organisationId,id,JSON.stringify({...summary,actorKind:'SYSTEM_MAINTENANCE',maintenanceReference:input.maintenanceReference,sourceRevision:input.primaryRevision,credentialsStored:true}),now]);
  await write.query('COMMIT');
 }catch(error){await write.query('ROLLBACK').catch(()=>{});throw error}finally{await write.end()}
 return{mode:'apply' as const,created:true,...summary};
}

import {db} from './db';
import {encryptIntegrationSecret,decryptIntegrationSecret} from './integrations/integration-secret-vault';
export const ADVERTISING_CONNECTION_DOMAIN='ADVERTISING_CONNECTION';
export async function metaConnection(organisationId:string){
 const row=await db.configurationProfile.findFirst({where:{organisationId,facilityId:null,domain:ADVERTISING_CONNECTION_DOMAIN,name:'meta'}});
 if(!row)return null;
 const config=row.config as {accountId:string;encryptedToken:string;version:string};
 return {account:config.accountId,token:decryptIntegrationSecret(config.encryptedToken),version:config.version};
}
export async function saveMetaConnection(organisationId:string,userId:string,token:string){
 // Fixed verified company account prevents accidental import of unrelated account data.
 const config={accountId:'1064679099720272',version:'v25.0',encryptedToken:encryptIntegrationSecret(token)};
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id"=${organisationId} FOR UPDATE`;
  const current=await tx.configurationProfile.findFirst({where:{organisationId,facilityId:null,domain:ADVERTISING_CONNECTION_DOMAIN,name:'meta'}});
  if(current)await tx.configurationProfile.update({where:{id:current.id},data:{config}});
  else await tx.configurationProfile.create({data:{organisationId,domain:ADVERTISING_CONNECTION_DOMAIN,name:'meta',config}});
  await tx.auditEvent.create({data:{organisationId,actorId:userId,action:'marketing.meta_connection.saved',entityType:'Organisation',entityId:organisationId,after:{accountId:config.accountId,credentialStored:true}}});
 });
}

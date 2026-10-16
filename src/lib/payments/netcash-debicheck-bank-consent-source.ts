import type {Prisma} from '@/generated/prisma/client';
import type {FacilityScope} from '@/lib/scope';
import {tenantCustomerScope} from '@/lib/tenant-portal-security';
import {readDebiCheckRequest,privateDebiCheckTerms,DEBICHECK_REQUEST_DOMAIN} from './netcash-debicheck-request-policy';
import {recheckDebiCheckSetupSource} from './netcash-debicheck-request-service';
import {bankAuthenticationPayerFingerprint,requireBankAuthenticationTestApproval} from './netcash-debicheck-bank-test-approval';
import {bankConsentSourceSchema} from './netcash-debicheck-bank-consent-policy';

type Client=Prisma.TransactionClient;
type Owner={organisationId:string;customerId:string;email:string};
/** Every binding comes from this same original, currently eligible setup and
 * its verified customer. Provider approval is separate trusted configuration;
 * no caller can supply an amount, bank identity, template or approval flag. */
export async function currentBankConsentSource(client:Client,scope:FacilityScope,owner:Owner,input:{accountId:string;requestId:string},now=new Date()){
 if(scope.organisationId!==owner.organisationId)throw Error('FORBIDDEN');
 const account=await client.account.findFirst({where:{id:input.accountId,customer:tenantCustomerScope({...owner,customerIds:[owner.customerId]}),tenancy:{facility:{organisationId:scope.organisationId,...(scope.unrestrictedFacilities?{}:{id:{in:scope.facilityIds}})}}},select:{customerId:true,tenancy:{select:{facilityId:true,customerId:true}}}});
 if(!account?.tenancy||account.customerId!==owner.customerId||account.tenancy.customerId!==owner.customerId)throw Error('DEBICHECK_BANK_CONSENT_ACCOUNT');
 const row=await client.configurationProfile.findFirst({where:{id:input.requestId,organisationId:scope.organisationId,facilityId:account.tenancy.facilityId,domain:DEBICHECK_REQUEST_DOMAIN,status:'REVIEWED'}});
 if(!row)throw Error('DEBICHECK_BANK_CONSENT_REVIEWED_SETUP_REQUIRED');
 const definition=readDebiCheckRequest(row.config,{id:row.id,organisationId:scope.organisationId,facilityId:account.tenancy.facilityId,accountId:input.accountId});
 if(definition.customerId!==owner.customerId)throw Error('DEBICHECK_BANK_CONSENT_ACCOUNT');
 const current=await recheckDebiCheckSetupSource(client,definition,owner,scope,now),terms=privateDebiCheckTerms(definition);
 const payerFingerprint=bankAuthenticationPayerFingerprint(scope.organisationId,account.tenancy.facilityId,terms);
 const approval=requireBankAuthenticationTestApproval({organisationId:scope.organisationId,facilityId:account.tenancy.facilityId,accountId:input.accountId,customerId:owner.customerId,merchantHash:definition.merchantHash,templateId:definition.templateId,templateSourceHash:definition.templateSourceHash,payerFingerprint,monthlyAmount:definition.monthlyAmount,startDate:definition.startDate},current.template.snapshot,now);
 return bankConsentSourceSchema.parse({organisationId:scope.organisationId,facilityId:account.tenancy.facilityId,accountId:input.accountId,customerId:owner.customerId,tenancyId:definition.tenancyId,requestId:definition.recordId,requestSignature:definition.signature,sourceHash:definition.sourceHash,merchantHash:definition.merchantHash,templateSourceHash:definition.templateSourceHash,templateId:definition.templateId,connectionId:definition.connectionId,connectionUpdatedAt:definition.connectionUpdatedAt,tenantIdentityHash:definition.tenantIdentityHash,providerApprovalId:approval.providerApprovalId,providerApprovalHash:approval.providerApprovalHash,payerFingerprint,monthlyAmount:definition.monthlyAmount,startDate:definition.startDate,bankSuffix:definition.bankSuffix});
}

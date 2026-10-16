import type {Prisma} from '@/generated/prisma/client';
import {currentRoleAccess} from '@/lib/current-role-access';
import {DEBICHECK_BANK_CONSENT_DOMAIN,bankAuthenticationConsentHash} from './netcash-debicheck-bank-consent-policy';
import {readStoredBankConsent} from './netcash-debicheck-bank-consent-record';
import type {DebiCheckAttemptSource} from './netcash-debicheck-attempt-policy';
import type {DebiCheckRequestDefinition} from './netcash-debicheck-request-policy';

/** Caller owns the account lock/transaction. Native retained consent and current
 * independent review are necessary authority, never provider/test-payer/source
 * approval by themselves. The guarded caller owns those separate checks. */
export async function requireNativeBankConsent(tx:Prisma.TransactionClient,source:DebiCheckAttemptSource,definition:DebiCheckRequestDefinition,now:Date){
 const rows=await tx.configurationProfile.findMany({where:{organisationId:source.organisationId,facilityId:source.facilityId,domain:DEBICHECK_BANK_CONSENT_DOMAIN,status:'REVIEWED',AND:[{config:{path:['accountId'],equals:source.accountId}},{config:{path:['requestId'],equals:source.requestId}},{config:{path:['consentHash'],equals:source.authenticationConsentHash}}]},take:2});
 if(rows.length!==1)throw Error('DEBICHECK_BANK_AUTHENTICATION_CONSENT_REQUIRED');
 const row=rows[0];if(row.name!==row.id)throw Error('DEBICHECK_BANK_AUTHENTICATION_CONSENT_REQUIRED');
 const value=readStoredBankConsent(row.config,{id:row.id,organisationId:source.organisationId,facilityId:source.facilityId,accountId:source.accountId,customerId:definition.customerId}),binding=value.source;
 for(const key of ['organisationId','facilityId','accountId','requestId','requestSignature','sourceHash','merchantHash','connectionId','connectionUpdatedAt','templateSourceHash']as const)if(binding[key]!==source[key])throw Error('DEBICHECK_BANK_AUTHENTICATION_CONSENT_REQUIRED');
 if(binding.customerId!==definition.customerId||binding.tenancyId!==definition.tenancyId||binding.templateId!==definition.templateId||binding.monthlyAmount!==definition.monthlyAmount||binding.startDate!==definition.startDate||binding.bankSuffix!==definition.bankSuffix||binding.tenantIdentityHash!==definition.tenantIdentityHash||bankAuthenticationConsentHash(value)!==source.authenticationConsentHash||!value.consentedAt||now<new Date(value.consentedAt)||now>=new Date(value.expiresAt))throw Error('DEBICHECK_BANK_AUTHENTICATION_CONSENT_REQUIRED');
 const consent=await tx.auditEvent.findFirst({where:{organisationId:source.organisationId,facilityId:source.facilityId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_bank_consent_saved',actorId:null},orderBy:{occurredAt:'asc'}}),consentValue=consent?.after as Record<string,unknown>|null;
 if(!consent||!consentValue||consentValue.accountId!==source.accountId||consentValue.customerId!==definition.customerId||consentValue.requestId!==source.requestId||consentValue.consentHash!==source.authenticationConsentHash||consentValue.consentedAt!==value.consentedAt||consent.occurredAt<new Date(value.consentedAt))throw Error('DEBICHECK_BANK_AUTHENTICATION_CONSENT_REQUIRED');
 const review=await tx.auditEvent.findFirst({where:{id:source.independentReviewAuditId,organisationId:source.organisationId,facilityId:source.facilityId,entityType:'ConfigurationProfile',entityId:row.id,action:'netcash.debicheck_bank_consent_reviewed',actorId:{not:null}}}),reviewValue=review?.after as Record<string,unknown>|null;
 if(!review||!reviewValue||reviewValue.accountId!==source.accountId||reviewValue.requestId!==source.requestId||reviewValue.consentHash!==source.authenticationConsentHash||review.occurredAt<consent.occurredAt||review.occurredAt>now)throw Error('DEBICHECK_BANK_AUTHENTICATION_REVIEW_REQUIRED');
 const reviewer=await tx.user.findFirst({where:{id:review.actorId!,organisationId:source.organisationId,active:true},include:{roleAssignments:{where:{role:{organisationId:source.organisationId}},include:{role:true}}}}),customer=await tx.customer.findFirst({where:{id:definition.customerId,organisationId:source.organisationId,emailVerifiedAt:{not:null}},select:{email:true}});
 if(!reviewer||!customer?.email||reviewer.email.toLowerCase()===customer.email.toLowerCase()||!currentRoleAccess(reviewer.roleAssignments,'payments.view',source.facilityId).allowed||!currentRoleAccess(reviewer.roleAssignments,'payments.bank_auth_review',source.facilityId).allowed)throw Error('DEBICHECK_BANK_AUTHENTICATION_REVIEW_REQUIRED');
 return{value,review};
}

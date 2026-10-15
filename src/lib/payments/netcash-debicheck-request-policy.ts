import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { cardSourceHash } from './card-autopay-enrollment-policy';
import { buildDebiCheckAuthenticationEnvelope, type DebiCheckAuthenticationTerms } from './netcash-debicheck-soap';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../integrations/integration-secret-vault';

export const DEBICHECK_REQUEST_DOMAIN = 'NETCASH_DEBICHECK_REQUEST';
export const DEBICHECK_REQUEST_TERMS = 'debicheck-setup-request-v1';
const id = z.string().min(1).max(120), hash = z.string().regex(/^[a-f\d]{64}$/);
export const debiCheckPayerSchema = z.object({
 debtorIdentification: z.string().min(1).max(50), debtorIdentificationCode: z.enum(['P','I','C']),
 accountName: z.string().min(1).max(100), bankAccountName: z.string().min(1).max(100),
 branchCode: z.string().regex(/^\d{6}$/), bankAccountNumber: z.string().regex(/^\d{5,20}$/),
 bankAccountType: z.enum(['Current','Savings','Transmission']), mobileNumber: z.string().regex(/^0\d{9}$/),
 emailAddress: z.string().email().max(100),
}).strict();
export type DebiCheckPayer = z.infer<typeof debiCheckPayerSchema>;
const definitionSchema = z.object({
 version:z.literal(1),recordId:z.string().regex(/^debicheck-request:[a-f\d-]{36}$/),
 organisationId:id,facilityId:id,accountId:id,customerId:id,tenancyId:id,
 sourceHash:hash,templateObservationId:id,templateSourceHash:hash,templateId:z.string().regex(/^NCDCT\d{9}$/),
 connectionId:id,connectionUpdatedAt:z.iso.datetime(),merchantHash:hash,environment:z.literal('sandbox'),
 startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),monthlyAmount:z.string().regex(/^\d{1,6}\.\d{2}$/),
 consentVersion:z.literal(DEBICHECK_REQUEST_TERMS),consentText:z.string().min(1).max(2000),
 consentAt:z.iso.datetime(),tenantIdentityHash:hash,bankSuffix:z.string().regex(/^\d{1,4}$/),
 encryptedTerms:z.string().min(1).max(10000),signature:hash,
}).strict();
export type DebiCheckRequestDefinition=z.infer<typeof definitionSchema>;
export type DebiCheckRequestUnsigned=Omit<DebiCheckRequestDefinition,'signature'>;
export function debiCheckRequestSignature(value:unknown){
 const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('DEBICHECK_SIGNING_REQUIRED');
 return createHmac('sha256',key).update('netcash-debicheck-request:v1:'+cardSourceHash(value)).digest('hex');
}
export function sealDebiCheckRequest(value:DebiCheckRequestUnsigned){
 const candidate={...value} as Partial<DebiCheckRequestDefinition>;delete candidate.signature;
 const plain=definitionSchema.omit({signature:true}).parse(candidate);
 return definitionSchema.parse({...plain,signature:debiCheckRequestSignature(plain)});
}
export function readDebiCheckRequest(value:unknown,identity:{id:string;organisationId:string;facilityId:string;accountId:string}){
 const parsed=definitionSchema.parse(value),{signature,...plain}=parsed;
 if(parsed.recordId!==identity.id||parsed.organisationId!==identity.organisationId||parsed.facilityId!==identity.facilityId||parsed.accountId!==identity.accountId||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(debiCheckRequestSignature(plain),'hex')))throw Error('DEBICHECK_REQUEST_INTEGRITY_REVIEW');
 return parsed;
}
export function debiCheckSetupRequestText(amount:string,startDate:string){
 return `I ask STOR24 to review DebiCheck setup for monthly payments of R${amount}, starting ${startDate}. I confirm that I may provide these bank-account details for this request. Saving or reviewing this request does not send it to my bank, sign a mandate or authorise a collection. I must separately review the provider mandate and complete bank authentication before any collection can be considered.`;
}
export function encryptDebiCheckTerms(terms:DebiCheckAuthenticationTerms){
 // Validate the complete current SOAP terms before retaining private data. This
 // synthetic key is validation-only: no network or merchant credential is used.
 buildDebiCheckAuthenticationEnvelope('11111111-1111-4111-8111-111111111111',terms);
 return encryptIntegrationSecret(JSON.stringify(terms));
}
export function privateDebiCheckTerms(definition:DebiCheckRequestDefinition){
 const value=JSON.parse(decryptIntegrationSecret(definition.encryptedTerms)) as DebiCheckAuthenticationTerms;
 buildDebiCheckAuthenticationEnvelope('11111111-1111-4111-8111-111111111111',value);
 if(value.accountReference!==definition.recordId.replace('debicheck-request:','').replaceAll('-','')||value.templateId!==definition.templateId||value.collectionAmount!==definition.monthlyAmount||value.firstCollectionAmount!==definition.monthlyAmount||value.firstCollectionDiffers!==false||value.firstCollectionDate!==definition.startDate||value.monthlyCollectionDay!==1||value.bankAccountNumber.slice(-4)!==definition.bankSuffix)throw Error('DEBICHECK_REQUEST_INTEGRITY_REVIEW');
 return value;
}
export function projectDebiCheckRequest(definition:DebiCheckRequestDefinition,status:string){
 if(!['PREVIEW','REQUESTED','REVIEWED','WITHDRAWN'].includes(status))throw Error('DEBICHECK_REQUEST_STATE_REVIEW');
 return{id:definition.recordId,accountId:definition.accountId,status,monthlyAmount:definition.monthlyAmount,startDate:definition.startDate,bankSuffix:definition.bankSuffix,consentText:definition.consentText,consentAt:definition.consentAt,environment:'sandbox' as const,authenticationSubmitted:false as const,collectionEnabled:false as const,financialReceipt:false as const};
}

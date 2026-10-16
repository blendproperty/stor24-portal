import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {cardSourceHash} from './card-autopay-enrollment-policy';

export const DEBICHECK_BANK_CONSENT_DOMAIN='NETCASH_DEBICHECK_BANK_CONSENT';
export const DEBICHECK_BANK_CONSENT_VERSION='debicheck-bank-authentication-v1';
const hash=z.string().regex(/^[a-f\d]{64}$/),id=z.string().min(1).max(160);
/** The application must obtain these bindings from current, independently
 * reviewed provider/test-payer evidence. A client ticket or this policy alone
 * is never authority to dispatch a request or to collect money. */
export const bankConsentSourceSchema=z.object({
 organisationId:id,facilityId:id,accountId:id,customerId:id,tenancyId:id,
 requestId:z.string().regex(/^debicheck-request:[a-f\d-]{36}$/),requestSignature:hash,
 sourceHash:hash,merchantHash:hash,templateSourceHash:hash,templateId:z.string().regex(/^NCDCT\d{9}$/),
 connectionId:id,connectionUpdatedAt:z.iso.datetime(),tenantIdentityHash:hash,
 providerApprovalId:id,providerApprovalHash:hash,payerFingerprint:hash,
 monthlyAmount:z.string().regex(/^(?:0|[1-9]\d{0,5})\.\d{2}$/).refine(value=>Number(value)>0),startDate:z.iso.date(),bankSuffix:z.string().regex(/^\d{1,4}$/),
}).strict();
export type BankConsentSource=z.infer<typeof bankConsentSourceSchema>;
const schema=z.object({version:z.literal(1),recordId:z.string().regex(/^debicheck-bank-consent:[a-f\d-]{36}$/),source:bankConsentSourceSchema,
 issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),consentedAt:z.iso.datetime().nullable(),consentVersion:z.literal(DEBICHECK_BANK_CONSENT_VERSION),consentText:z.string().min(1).max(2000),signature:hash,
}).strict();
export type DebiCheckBankConsent=z.infer<typeof schema>;
const signature=(value:unknown)=>{
 const key=process.env.AUTH_SECRET;
 if(!key||key.length<32)throw Error('DEBICHECK_BANK_CONSENT_SIGNING_REQUIRED');
 return createHmac('sha256',key).update('debicheck-bank-consent:v1:').update(cardSourceHash(value)).digest('hex');
};
export function bankAuthenticationConsentText(source:BankConsentSource){
 return `I authorise STOR24 to send one DebiCheck bank-authentication request for R${source.monthlyAmount} monthly from ${source.startDate} to the bank account ending ${source.bankSuffix}. I confirm that I may request authentication for this account. I will respond through my bank. Saving this consent does not submit the request, take a payment or authorise a separate collection. Staff must independently review this exact request before any bank request can be considered.`;
}
function seal(value:Omit<DebiCheckBankConsent,'signature'>){const parsed=schema.omit({signature:true}).parse(value);return schema.parse({...parsed,signature:signature(parsed)})}
export function prepareBankAuthenticationConsent(source:BankConsentSource,now=new Date()){
 const parsed=bankConsentSourceSchema.parse(source);
 return seal({version:1,recordId:'debicheck-bank-consent:'+randomUUID(),source:parsed,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString(),consentedAt:null,consentVersion:DEBICHECK_BANK_CONSENT_VERSION,consentText:bankAuthenticationConsentText(parsed)});
}
export function readBankAuthenticationConsent(raw:unknown,identity:{id:string;organisationId:string;facilityId:string;accountId:string;customerId:string}){
 const parsed=schema.parse(raw),{signature:stored,...plain}=parsed,source=parsed.source;
 if(parsed.recordId!==identity.id||source.organisationId!==identity.organisationId||source.facilityId!==identity.facilityId||source.accountId!==identity.accountId||source.customerId!==identity.customerId||
  !timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(signature(plain),'hex'))||parsed.consentText!==bankAuthenticationConsentText(source)||
  Date.parse(parsed.expiresAt)-Date.parse(parsed.issuedAt)!==600000||parsed.consentedAt!==null&&(Date.parse(parsed.consentedAt)<Date.parse(parsed.issuedAt)||Date.parse(parsed.consentedAt)>=Date.parse(parsed.expiresAt)))throw Error('DEBICHECK_BANK_CONSENT_INTEGRITY');
 return parsed;
}
export function acceptBankAuthenticationConsent(preview:DebiCheckBankConsent,now=new Date()){
 const value=readBankAuthenticationConsent(preview,{id:preview.recordId,...preview.source});
 if(value.consentedAt!==null||now<new Date(value.issuedAt)||now>=new Date(value.expiresAt))throw Error('DEBICHECK_BANK_CONSENT_EXPIRED');
 const{signature:discarded,...plain}=value;void discarded;
 return seal({...plain,consentedAt:now.toISOString()});
}
export const bankAuthenticationConsentHash=(value:DebiCheckBankConsent)=>signature({recordId:value.recordId,source:value.source,consentVersion:value.consentVersion,consentText:value.consentText,consentedAt:value.consentedAt,expiresAt:value.expiresAt});
export function projectBankAuthenticationConsent(value:DebiCheckBankConsent,status:'PREVIEW'|'CONSENTED'|'REVIEWED'|'WITHDRAWN',now=new Date()){
 if((status==='PREVIEW')!==(value.consentedAt===null))throw Error('DEBICHECK_BANK_CONSENT_STATE');
 return{id:value.recordId,requestId:value.source.requestId,accountId:value.source.accountId,status,monthlyAmount:value.source.monthlyAmount,startDate:value.source.startDate,bankSuffix:value.source.bankSuffix,consentText:value.consentText,consentedAt:value.consentedAt,expiresAt:value.expiresAt,expired:now>=new Date(value.expiresAt),providerActionPerformed:false as const,collectionEnabled:false as const,financialReceipt:false as const,retryAllowed:false as const};
}

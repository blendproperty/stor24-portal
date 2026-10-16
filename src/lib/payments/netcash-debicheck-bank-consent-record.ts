import {z} from 'zod';
import {encryptIntegrationSecret,decryptIntegrationSecret} from '@/lib/integrations/integration-secret-vault';
import {readBankAuthenticationConsent,bankAuthenticationConsentHash,type DebiCheckBankConsent} from './netcash-debicheck-bank-consent-policy';

const storage=z.object({version:z.literal(1),accountId:z.string(),customerId:z.string(),requestId:z.string(),consentHash:z.string().regex(/^[a-f\d]{64}$/),encryptedConsent:z.string().min(1).max(20000)}).strict();
export function encryptBankConsent(value:DebiCheckBankConsent){
 if(!value.consentedAt)throw Error('DEBICHECK_BANK_CONSENT_STATE');
 readBankAuthenticationConsent(value,{id:value.recordId,...value.source});
 return storage.parse({version:1,accountId:value.source.accountId,customerId:value.source.customerId,requestId:value.source.requestId,consentHash:bankAuthenticationConsentHash(value),encryptedConsent:encryptIntegrationSecret(JSON.stringify(value))});
}
export function readStoredBankConsent(raw:unknown,identity:{id:string;organisationId:string;facilityId:string;accountId:string;customerId:string}){
 const stored=storage.parse(raw),value=readBankAuthenticationConsent(JSON.parse(decryptIntegrationSecret(stored.encryptedConsent)),identity);
 if(!value.consentedAt||stored.accountId!==value.source.accountId||stored.customerId!==value.source.customerId||stored.requestId!==value.source.requestId||stored.consentHash!==bankAuthenticationConsentHash(value))throw Error('DEBICHECK_BANK_CONSENT_INTEGRITY');
 return value;
}

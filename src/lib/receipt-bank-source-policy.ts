import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {encryptIntegrationSecret,decryptIntegrationSecret} from './integrations/integration-secret-vault';

// PostgreSQL jsonb does not preserve object insertion order. Hash semantic
// object keys canonically while retaining array order and exact scalar values.
export const receiptSourceHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item)).digest('hex');
const hash=z.string().regex(/^[a-f\d]{64}$/),id=z.string().min(1).max(120);
const bankCode=z.string().trim().toUpperCase().regex(/^[A-Z]{4}ZA[A-Z\d]{2}$/);
const privateSchema=z.object({bankCode,accountNumber:z.string().regex(/^\d{5,20}$/).refine(value=>BigInt(value)>0)}).strict();
export const bankSourceCreateSchema=privateSchema.extend({label:z.string().trim().min(3).max(80),requestKey:z.uuid(),reference:z.string().trim().min(5).max(240),confirmed:z.literal(true)}).strict();
export const bankSourceReviewSchema=z.object({id:z.uuid(),revision:z.number().int().min(0),action:z.enum(['approve','reject','withdraw','revoke','request-review']),reference:z.string().trim().min(5).max(240),requestKey:z.uuid().optional(),confirmed:z.literal(true)}).strict().refine(value=>value.action!=='request-review'||!!value.requestKey);
export type BankSourceCreate=z.infer<typeof bankSourceCreateSchema>;
const identitySchema=z.object({id:z.uuid(),organisationId:id,bankIdentityHash:hash,bankCode:z.string().regex(/^[A-Z]{4}ZA[A-Z\d]{2}$/),accountSuffix:z.string().regex(/^\d{1,4}$/),label:z.string().min(3).max(80),currency:z.literal('ZAR'),identityEncrypted:z.string().min(1).max(5000),identitySignature:hash});
export type BankSourceIdentity=z.infer<typeof identitySchema>;
function signature(value:unknown){const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('RECEIPT_BANK_SIGNING_REQUIRED');return createHmac('sha256',key).update('receipt-bank-source:v1:'+receiptSourceHash(value)).digest('hex');}
function identityHash(organisationId:string,bank:ReturnType<typeof privateSchema.parse>){
 // Institution BIC and account number form the stable source namespace; a new
 // display alias, branch code or zero-padding cannot create another cash root.
 return receiptSourceHash(['receipt-bank-identity:v1',organisationId,bank.bankCode,BigInt(bank.accountNumber).toString()]);
}
export function prepareBankSourceIdentity(raw:unknown,recordId:string,organisationId:string){
 const input=bankSourceCreateSchema.parse(raw),bank=privateSchema.parse({bankCode:input.bankCode,accountNumber:input.accountNumber});
 const plain={id:recordId,organisationId,bankIdentityHash:identityHash(organisationId,bank),bankCode:bank.bankCode,accountSuffix:bank.accountNumber.slice(-4),label:input.label,currency:'ZAR' as const,identityEncrypted:encryptIntegrationSecret(JSON.stringify(bank))};
 return identitySchema.parse({...plain,identitySignature:signature(plain)});
}
export function readBankSourceIdentity(value:unknown){
 const parsed=identitySchema.parse(value),{identitySignature:stored,...plain}=parsed;
 if(!timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(signature(plain),'hex')))throw Error('RECEIPT_BANK_SOURCE_INTEGRITY');
 return parsed;
}
export function privateBankSourceIdentity(value:unknown){
 const source=readBankSourceIdentity(value),bank=privateSchema.parse(JSON.parse(decryptIntegrationSecret(source.identityEncrypted)));
 if(bank.bankCode!==source.bankCode||bank.accountNumber.slice(-4)!==source.accountSuffix||identityHash(source.organisationId,bank)!==source.bankIdentityHash)throw Error('RECEIPT_BANK_SOURCE_INTEGRITY');
 return bank;
}

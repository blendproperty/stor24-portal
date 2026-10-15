import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {dateKey} from './collections-policy';
import {receiptSourceHash} from './receipt-bank-source-policy';

export const RECEIPT_POSTING_TERMS='receipt-import-posting-v1';
const id=z.string().cuid(),hash=z.string().regex(/^[a-f\d]{64}$/);
export const receiptPostingInputSchema=z.object({intakeId:id,proposalId:id,facilityId:id,approvalReference:z.string().trim().min(5).max(240),originalStatementConfirmed:z.literal(true),customerReceiptConfirmed:z.literal(true),noPriorReceiptConfirmed:z.literal(true)}).strict();
const methodSchema=z.enum(['EFT','CARD','DEBIT_ORDER','RETAIL','QR','PAYFLEX','PAYMYWAY','VOUCHER']);
// Provider statement transaction semantics, checked against the current
// standard-integration/netcash-statement reference. Auth/return/funding rows
// have no fallback: they never become customer receipts through this mapping.
const methods=new Map<string,z.infer<typeof methodSchema>>([
 ['PNC','CARD'],['PVC','CARD'],['PNE','EFT'],['PIS','EFT'],['PNP','RETAIL'],['PNM','QR'],['PQR','QR'],
 ['TDD','DEBIT_ORDER'],['SDD','DEBIT_ORDER'],['TDC','CARD'],['SDC','CARD'],['DCS','DEBIT_ORDER'],
 ['PFC','PAYFLEX'],['PMW','PAYMYWAY'],['PGC','VOUCHER'],
]);
export function importedReceiptMethod(sourceType:string,code?:string){
 if(sourceType==='BANK_IMPORT_ENTRY')return'EFT' as const;
 const method=sourceType==='NETCASH_STATEMENT_LINE'&&code?methods.get(code):null;
 if(!method)throw Error('RECEIPT_POSTING_METHOD_REVIEW');
 return method;
}
const previewSchema=receiptPostingInputSchema.extend({version:z.literal(1),termsVersion:z.literal(RECEIPT_POSTING_TERMS),organisationId:id,userId:id,accountId:id,accountNumber:z.string().min(1).max(200),sourceIdentity:hash,sourceFingerprint:hash,amount:z.string().regex(/^\d{1,8}\.\d{2}$/).refine(value=>Number(value)>0),currency:z.literal('ZAR'),receiptDate:dateKey,method:methodSchema,fingerprint:hash,preparedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),signature:hash}).strict();
export type ReceiptPostingPreview=z.infer<typeof previewSchema>;
function sign(value:unknown){const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('RECEIPT_BANK_SIGNING_REQUIRED');return createHmac('sha256',key).update('receipt-import-preview:v1:'+receiptSourceHash(value)).digest('hex');}
export function sealReceiptPostingPreview(value:Omit<ReceiptPostingPreview,'signature'>){
 const plain=previewSchema.omit({signature:true}).parse(value);return previewSchema.parse({...plain,signature:sign(plain)});
}
export function readReceiptPostingPreview(value:unknown,identity:{organisationId:string;userId:string;facilityId:string}){
 const parsed=previewSchema.parse(value),{signature,...plain}=parsed;
 if(parsed.organisationId!==identity.organisationId||parsed.userId!==identity.userId||parsed.facilityId!==identity.facilityId||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(plain),'hex')))throw Error('RECEIPT_POSTING_CHANGED');
 return parsed;
}
export function assertReceiptPostingPreviewCurrent(value:ReceiptPostingPreview,now:Date){
 const prepared=new Date(value.preparedAt),expires=new Date(value.expiresAt);
 if(prepared>now||expires<=now||expires.getTime()-prepared.getTime()!==600000)throw Error('RECEIPT_POSTING_PREVIEW_EXPIRED');
}

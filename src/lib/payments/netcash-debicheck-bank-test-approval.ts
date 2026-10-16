import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {cardSourceHash} from './card-autopay-enrollment-policy';
import type {DebiCheckAuthenticationTerms,parseDebiCheckTemplate} from './netcash-debicheck-soap';

const id=z.string().min(1).max(160),hash=z.string().regex(/^[a-f\d]{64}$/);
/** Deployment evidence, not a client-supplied permission. No default payer,
 * template, amount or approval is inferred from the signing-only test details
 * or from enabling Pay Now test payments. Never contains bank numbers/keys. */
const approvalBaseSchema=z.object({version:z.literal(1),purpose:z.literal('BANK_AUTHENTICATION_TEST_ONLY'),authenticationMode:z.literal('TT1_SYNCHRONOUS'),
 organisationId:id,facilityId:id,accountId:id,customerId:id,merchantHash:hash,
 templateId:z.string().regex(/^NCDCT\d{9}$/),templateSourceHash:hash,payerFingerprint:hash,
 monthlyAmount:z.string().regex(/^(?:0|[1-9]\d{0,5})\.\d{2}$/).refine(value=>Number(value)>0),startDate:z.iso.date(),
 approvedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),providerEvidenceReference:z.string().trim().min(3).max(200),approvalRecordedBy:z.string().trim().min(3).max(160),
 collectionAuthorised:z.literal(false),
}).strict();
const approvalSchema=approvalBaseSchema.superRefine((value,ctx)=>{
 const duration=Date.parse(value.expiresAt)-Date.parse(value.approvedAt);
 if(duration<=0||duration>86400000)ctx.addIssue({code:'custom',message:'A provider-approved test window of at most24hours is required'});
});
export type BankAuthenticationTestApproval=z.infer<typeof approvalSchema>;
const bindingSchema=approvalBaseSchema.pick({organisationId:true,facilityId:true,accountId:true,customerId:true,merchantHash:true,templateId:true,templateSourceHash:true,payerFingerprint:true,monthlyAmount:true,startDate:true});
const bindingKeys=['organisationId','facilityId','accountId','customerId','merchantHash','templateId','templateSourceHash','payerFingerprint','monthlyAmount','startDate']as const;
export function bankAuthenticationPayerFingerprint(organisationId:string,facilityId:string,terms:DebiCheckAuthenticationTerms){
 const key=process.env.AUTH_SECRET;if(!key||key.length<32)throw Error('DEBICHECK_BANK_CONSENT_SIGNING_REQUIRED');
 return createHmac('sha256',key).update('debicheck-bank-test-payer:v1:').update(cardSourceHash({organisationId,facilityId,debtorIdentification:terms.debtorIdentification,debtorIdentificationCode:terms.debtorIdentificationCode,bankAccountName:terms.bankAccountName,branchCode:terms.branchCode,bankAccountNumber:terms.bankAccountNumber,bankAccountType:terms.bankAccountType,mobileNumber:terms.mobileNumber,emailAddress:terms.emailAddress.toLowerCase()})).digest('hex');
}
/** One canonical parser for every source and final pretransport guard. */
export function readBankAuthenticationTestApproval(now=new Date()){
 const raw=process.env.NETCASH_DEBICHECK_AUTHENTICATION_TEST_APPROVAL;
 if(!raw||raw.length>8192)throw Error('DEBICHECK_BANK_TEST_APPROVAL_REQUIRED');
 let approval:BankAuthenticationTestApproval;
 try{approval=approvalSchema.parse(JSON.parse(raw))}catch{throw Error('DEBICHECK_BANK_TEST_APPROVAL_REQUIRED')}
 if(now<new Date(approval.approvedAt)||new Date(approval.expiresAt).getTime()-now.getTime()<600000)throw Error('DEBICHECK_BANK_TEST_APPROVAL_EXPIRED');
 return approval;
}
export function requireBankAuthenticationTestApproval(expected:Pick<BankAuthenticationTestApproval,'organisationId'|'facilityId'|'accountId'|'customerId'|'merchantHash'|'templateId'|'templateSourceHash'|'payerFingerprint'|'monthlyAmount'|'startDate'>,template:ReturnType<typeof parseDebiCheckTemplate>,now=new Date()){
 const binding=bindingSchema.parse(expected);
 const approval=readBankAuthenticationTestApproval(now);
 for(const key of bindingKeys)if(approval[key]!==binding[key])throw Error('DEBICHECK_BANK_TEST_APPROVAL_SOURCE_CHANGED');
 if(template.templateId!==binding.templateId||cardSourceHash(template)!==binding.templateSourceHash)throw Error('DEBICHECK_BANK_TEST_APPROVAL_SOURCE_CHANGED');
 // Exact observed snapshot is covered by the configured provider approval.
 // Reject positively contradictory batch/RMS evidence independently of that
 // approval. Unknown raw TT1 enum spellings are not invented or normalised.
 const detail=template.detail;
 if(detail.RMS!=='False'||detail.CollectionFrequency!=='MNTH'||detail.InstallmentOccurrence!=='RCUR'||!template.monthlyDayOptions.includes('MNTH_01')||!detail.AuthenticationType||!detail.DebtorAuthCode||/BATCH|TT2/i.test(detail.AuthenticationType+' '+detail.DebtorAuthCode))throw Error('DEBICHECK_REALTIME_TEMPLATE_REVIEW');
 const providerApprovalHash=cardSourceHash(approval);
 return{providerApprovalId:'debicheck-test-approval:'+providerApprovalHash,providerApprovalHash,expiresAt:approval.expiresAt};
}

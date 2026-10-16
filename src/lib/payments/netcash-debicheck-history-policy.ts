import {z} from 'zod';

export const debiCheckHistoryStatus=z.enum(['CLAIMED','BANK_AUTHENTICATED','BANK_REJECTED','REQUEST_REJECTED','OUTCOME_UNKNOWN']);
export const debiCheckHistoryQuery=z.object({facilityId:z.cuid(),status:debiCheckHistoryStatus.optional(),cursor:z.string().max(800).optional(),attemptId:z.string().regex(/^debicheck-attempt:[a-f\d-]{36}$/).optional(),observationCursor:z.string().max(800).optional()}).strict();
const attempt=z.object({id:z.string().regex(/^debicheck-attempt:[a-f\d-]{36}$/),requestId:z.string().regex(/^debicheck-request:[a-f\d-]{36}$/),accountNumber:z.string().min(1),bankSuffix:z.string().regex(/^\d{1,4}$/),monthlyAmount:z.string().regex(/^\d{1,6}\.\d{2}$/),startDate:z.iso.date(),claimedAt:z.iso.datetime(),completedAt:z.iso.datetime().nullable(),status:debiCheckHistoryStatus,bankAuthenticationObserved:z.boolean(),originalContractAvailable:z.boolean(),reconciliationRequired:z.boolean(),retryAllowed:z.literal(false),collectionAuthorised:z.literal(false),financialReceipt:z.literal(false)}).strict().superRefine((value,ctx)=>{
 if((value.status==='CLAIMED')!==(value.completedAt===null)||value.bankAuthenticationObserved!==(value.status==='BANK_AUTHENTICATED')||value.reconciliationRequired!==['CLAIMED','OUTCOME_UNKNOWN'].includes(value.status)||['BANK_AUTHENTICATED','BANK_REJECTED'].includes(value.status)&&!value.originalContractAvailable)ctx.addIssue({code:'custom',message:'Inconsistent retained authentication outcome'});
});
const observation=z.object({id:z.string().min(1).max(250),attemptId:z.string(),observedAt:z.iso.datetime(),bankAuthenticationObserved:z.boolean(),retryAllowed:z.literal(false),collectionAuthorised:z.literal(false),financialReceipt:z.literal(false)}).strict();
export const debiCheckHistorySnapshot=z.object({facilityId:z.cuid(),attempts:z.array(attempt).max(20),nextCursor:z.string().nullable(),selected:attempt.nullable(),observations:z.array(observation).max(20),nextObservationCursor:z.string().nullable(),providerQueried:z.literal(false)}).strict().superRefine((value,ctx)=>{
 if(value.observations.some(row=>row.attemptId!==value.selected?.id)||!value.selected&&value.nextObservationCursor)ctx.addIssue({code:'custom',message:'Mismatched retained history'});
});
export type DebiCheckHistorySnapshot=z.infer<typeof debiCheckHistorySnapshot>;

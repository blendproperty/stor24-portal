import {createHash} from 'node:crypto';
import {z} from 'zod';
import {billingPeriodSchema,periodDates} from './monthly-billing-policy';
import type {ReportRow} from './report-data-service';
const postingMoney=z.number().finite().nonnegative().max(999999999999.99).refine(value=>Number(value.toFixed(2))===value);
const posting=z.object({period:billingPeriodSchema,invoiceNumber:z.string().min(1).max(250),documentId:z.string().min(1),total:postingMoney,taxTotal:postingMoney,fingerprint:z.string().regex(/^[a-f\d]{64}$/)});
const metadata=z.object({billingPeriod:billingPeriodSchema,invoiceNumber:z.string(),approvalReference:z.string().min(5),fingerprint:z.string().regex(/^[a-f\d]{64}$/),chargeKey:z.string().optional()});
const cents=(value:string)=>{if(!/^\d{1,12}\.\d{2}$/.test(value))throw Error('POSTED_BILL_AMOUNT_REVIEW');return BigInt(value.replace('.',''));};
const money=(value:bigint)=>{const sign=value<BigInt(0)?'-':'';const absolute=value<BigInt(0)?-value:value;return`${sign}${absolute/BigInt(100)}.${String(absolute%BigInt(100)).padStart(2,'0')}`;};
export type PostedBillSource={facility:string;facilityId:string;accountId:string;recordedAt:string;posting:unknown;document:{id:string;externalId:string|null;content:string|null;sha256:string|null}|null;entries:{id:string;accountId:string;type:string;amount:string;taxAmount:string;effectiveAt:string;description:string;metadata:unknown}[]};
/** Original posted amounts only: no current rates, receipts, balances or income recognition. */
export function postedRecurringRows(source:PostedBillSource,snapshotTakenAt:string):ReportRow[]{
 const base={snapshotTakenAt,basis:'Original posted monthly billing lines',currency:'ZAR',facility:source.facility,facilityId:source.facilityId,accountId:source.accountId,recordedAt:source.recordedAt,financialReceipt:false,settlementVerified:false,correctionsIncluded:false,incomeRecognition:'Not assessed'};
 const hold=(reason:string):ReportRow[]=>[{...base,status:'REVIEW',invoice:null,period:null,entryId:null,effectiveAt:null,category:null,description:null,amount:null,includedTax:null,approvalReference:null,review:reason}];
 const parsed=posting.safeParse(source.posting);if(!parsed.success)return hold('Missing or invalid canonical billing-posting evidence');const bill=parsed.data,doc=source.document;
 if(!doc||doc.id!==bill.documentId||doc.externalId!==bill.invoiceNumber||!doc.content||!doc.sha256||createHash('sha256').update(doc.content).digest('hex')!==doc.sha256)return hold('Original invoice snapshot needs review');
 if(!source.entries.length||source.entries.length>100||new Set(source.entries.map(e=>e.id)).size!==source.entries.length)return hold('Missing or duplicate original billing lines');
 let total=BigInt(0),tax=BigInt(0);const rows:ReportRow[]=[];
 try{for(const entry of source.entries){
  const m=metadata.safeParse(entry.metadata);if(!m.success||entry.accountId!==source.accountId||!['CHARGE','CREDIT'].includes(entry.type)||m.data.billingPeriod!==bill.period||m.data.invoiceNumber!==bill.invoiceNumber||m.data.fingerprint!==bill.fingerprint||new Date(entry.effectiveAt).getTime()!==periodDates(bill.period).effectiveAt.getTime())return hold('Original billing line or effective date does not match posting evidence');
  const sign=entry.type==='CREDIT'?BigInt(-1):BigInt(1),amount=cents(entry.amount)*sign,includedTax=cents(entry.taxAmount)*sign;if((includedTax<BigInt(0)?-includedTax:includedTax)>(amount<BigInt(0)?-amount:amount))return hold('Included tax exceeds the original line amount');total+=amount;tax+=includedTax;
  const key=m.data.chargeKey;const category=key?.startsWith('rent:')?'RENT':key==='discount'?'DISCOUNT':key==='insurance'?'INSURANCE':key?.startsWith('charge:')?'OTHER':'UNCLASSIFIED';
  rows.push({...base,status:'POSTED',invoice:bill.invoiceNumber,period:bill.period,entryId:entry.id,effectiveAt:entry.effectiveAt,category,description:entry.description,amount:money(amount),includedTax:money(includedTax),approvalReference:m.data.approvalReference,review:key?null:'Original source has no retained component key; category is not inferred'});
 }}catch{return hold('Original billing amounts need review');}
 if(total!==cents(bill.total.toFixed(2))||tax!==cents(bill.taxTotal.toFixed(2)))return hold('Original billing totals do not reconcile to posting evidence');
 return rows;
}

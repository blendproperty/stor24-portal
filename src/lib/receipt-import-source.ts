import {createHash} from 'node:crypto';
import {parseBankCsvSource,parseDailyStatement,units} from './settlement-policy';

function originalHash(raw:string,sha256:string){
 if(raw.length>500000||!/^[a-f\d]{64}$/.test(sha256)||createHash('sha256').update(raw,'utf8').digest('hex')!==sha256)throw Error('RECEIPT_REVIEW_SOURCE_INTEGRITY');
}

/** Verify the exact retained normalised extract and selected row. A source-
 * declared ZAR cell is still subject to independent original-statement review;
 * absent currency never inherits the customer's account currency. */
export function bankReceiptSource(raw:string,sha256:string,entry:{transactionId:string;date:string;amount:string;reference:string}){
 originalHash(raw,sha256);
 let source:ReturnType<typeof parseBankCsvSource>;
 try{source=parseBankCsvSource(raw);}catch{throw Error('RECEIPT_REVIEW_SOURCE_INTEGRITY');}
 const row=source.entries.find(value=>value.transactionId===entry.transactionId);
 if(!row||row.date!==entry.date||units(row.amount)!==units(entry.amount)||row.reference!==entry.reference)throw Error('RECEIPT_REVIEW_SOURCE_INTEGRITY');
 return{sourceCurrency:source.currency};
}

/** Match the selected financial line to a checksum-verified, fully balanced
 * retained Netcash statement. An authorisation line is never a settled receipt. */
export function netcashReceiptSource(raw:string,sha256:string,statement:{date:string;opening:string;closing:string},line:{transactionId:string;date:string;code:string;description:string;amount:string;vat:string;extras:unknown;kind:string}){
 originalHash(raw,sha256);
 let source:ReturnType<typeof parseDailyStatement>;
 try{source=parseDailyStatement(raw,statement.date);}catch{throw Error('RECEIPT_REVIEW_SOURCE_INTEGRITY');}
 if(units(source.opening)!==units(statement.opening)||units(source.closing)!==units(statement.closing))throw Error('RECEIPT_REVIEW_SOURCE_INTEGRITY');
 const original=source.lines.find(value=>value.transactionId===line.transactionId);
 if(!original||original.kind!=='RECEIPT'||line.kind!=='RECEIPT'||original.date!==line.date||original.code!==line.code||original.description!==line.description||units(original.amount)!==units(line.amount)||units(original.vat)!==units(line.vat)||JSON.stringify(original.extras)!==JSON.stringify(line.extras))throw Error('RECEIPT_REVIEW_SOURCE_INTEGRITY');
 return{sourceCurrency:'ZAR' as const};
}

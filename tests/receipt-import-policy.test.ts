import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {importedReceiptMethod,sealReceiptPostingPreview,readReceiptPostingPreview,assertReceiptPostingPreviewCurrent,RECEIPT_POSTING_TERMS} from '../src/lib/receipt-import-policy';
import {lineKind} from '../src/lib/settlement-policy';
test('Netcash receipt methods follow successful statement codes and preserve card, EFT, QR, retail and alternative tenders',()=>{
 for(const [code,method]of [['PNC','CARD'],['PVC','CARD'],['TDC','CARD'],['SDC','CARD'],['PNE','EFT'],['PIS','EFT'],['PNP','RETAIL'],['PNM','QR'],['PQR','QR'],['TDD','DEBIT_ORDER'],['SDD','DEBIT_ORDER'],['DCS','DEBIT_ORDER'],['PFC','PAYFLEX'],['PMW','PAYMYWAY'],['PGC','VOUCHER']]){assert.equal(importedReceiptMethod('NETCASH_STATEMENT_LINE',code),method);assert.equal(lineKind(code,BigInt(10000)),'RECEIPT');}
 for(const code of ['PNA','PIA','PFA','PMB','PGA','PCD','PNR','PVR','DRU','DCM','RMS','ZZZ'])assert.throws(()=>importedReceiptMethod('NETCASH_STATEMENT_LINE',code),/METHOD_REVIEW/);
 assert.equal(importedReceiptMethod('BANK_IMPORT_ENTRY'),'EFT');assert.throws(()=>importedReceiptMethod('MANUAL_REPORTED'),/METHOD_REVIEW/);
});
test('posting preview binds exact actor, store, original cash and explicit attestations and expires after ten minutes',()=>{
 const old=process.env.AUTH_SECRET;process.env.AUTH_SECRET=randomBytes(32).toString('hex');
 try{
  const id='cabcdefghijklmno123456789',now=new Date('2026-10-15T12:00:00Z'),identity={organisationId:id,userId:id,facilityId:id};
  const value=sealReceiptPostingPreview({...identity,version:1,termsVersion:RECEIPT_POSTING_TERMS,intakeId:id,proposalId:id,accountId:id,accountNumber:'Synthetic account',approvalReference:'Synthetic source review',originalStatementConfirmed:true,customerReceiptConfirmed:true,noPriorReceiptConfirmed:true,sourceIdentity:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),amount:'100.25',currency:'ZAR',receiptDate:'2026-10-14',method:'CARD',fingerprint:'c'.repeat(64),preparedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString()});
  assert.deepEqual(readReceiptPostingPreview(value,identity),value);assertReceiptPostingPreviewCurrent(value,now);
  for(const patch of [{amount:'100.26'},{receiptDate:'2026-10-15'},{accountNumber:'Other account'},{method:'EFT'},{noPriorReceiptConfirmed:false}])assert.throws(()=>readReceiptPostingPreview({...value,...patch},identity));
  for(const key of ['organisationId','userId','facilityId']as const)assert.throws(()=>readReceiptPostingPreview(value,{...identity,[key]:'cother123456789abcdefghijk'}),/CHANGED/);
  assert.throws(()=>assertReceiptPostingPreviewCurrent(value,new Date(now.getTime()+600000)),/EXPIRED/);assert.throws(()=>assertReceiptPostingPreviewCurrent(value,new Date(now.getTime()-1)),/EXPIRED/);
 }finally{if(old===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=old;}
});

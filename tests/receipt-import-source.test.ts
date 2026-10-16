import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {parseBankCsv,parseBankCsvSource} from '../src/lib/settlement-policy';
import {bankReceiptSource,netcashReceiptSource} from '../src/lib/receipt-import-source';
const hash=(raw:string)=>createHash('sha256').update(raw,'utf8').digest('hex');
const entry={transactionId:'BANK-1',date:'2026-10-14',amount:'123.4500',reference:'Synthetic bank reference'};
const legacy='transaction_id,date,amount,reference\nBANK-1,2026-10-14,123.45,Synthetic bank reference\n';
const declared=legacy.replace('reference\n','reference,currency\n').replace('reference\n','reference,ZAR\n');
test('bank extracts retain absent versus source-declared currency without changing existing parsed rows',()=>{
 assert.equal(parseBankCsvSource(legacy).currency,null);assert.equal(parseBankCsvSource(declared).currency,'ZAR');
 assert.deepEqual(parseBankCsv(legacy),parseBankCsv(declared));
 assert.deepEqual(bankReceiptSource(legacy,hash(legacy),entry),{sourceCurrency:null});
 assert.deepEqual(bankReceiptSource(declared,hash(declared),entry),{sourceCurrency:'ZAR'});
 for(const currency of ['USD','zar','',' ZAR','ZAR '])assert.throws(()=>parseBankCsvSource(declared.replace(',ZAR\n',','+currency+'\n')),/SETTLEMENT_CURRENCY/);
});
test('bank receipt evidence checks the exact original hash and every selected row field',()=>{
 for(const value of [declared+'\n',declared.replace('123.45','124.45'),declared.replace('ZAR','USD')])assert.throws(()=>bankReceiptSource(value,hash(declared),entry),/SOURCE_INTEGRITY/);
 for(const value of [{...entry,transactionId:'OTHER'},{...entry,date:'2026-10-13'},{...entry,amount:'123.4501'},{...entry,reference:'Different reference'}])assert.throws(()=>bankReceiptSource(declared,hash(declared),value),/SOURCE_INTEGRITY/);
 const malformed='not a statement';assert.throws(()=>bankReceiptSource(malformed,hash(malformed),entry),/SOURCE_INTEGRITY/);
});
test('bank source currency rejects ambiguous headers, row counts and inconsistent declarations',()=>{
 for(const raw of [declared.replace('reference,currency','currency,reference'),declared.replace(',ZAR\n','\n'),declared.replace(',ZAR\n',',ZAR,extra\n'),declared+'BANK-2,2026-10-14,1,Other,USD\n'])assert.throws(()=>parseBankCsvSource(raw));
});
const statement=[
 '20261014\tOBL\t0\tOpening\t0\t+\t0',
 '20261014\tPNA\t1\tSynthetic authorisation\t0\t+\t0',
 '20261014\tPNC\t2\tSynthetic settled card receipt\t123.45\t+\t0',
 '20261014\tCBL\t0\tClosing\t123.45\t+\t0',
].join('\n');
const line={transactionId:'2',date:'2026-10-14',code:'PNC',description:'Synthetic settled card receipt',amount:'123.45',vat:'0',extras:['','',''],kind:'RECEIPT'};
test('Netcash receipts bind a settled financial row to the complete balanced retained source',()=>{
 assert.deepEqual(netcashReceiptSource(statement,hash(statement),{date:'2026-10-14',opening:'0',closing:'123.45'},line),{sourceCurrency:'ZAR'});
 for(const changed of [{transactionId:'1',code:'PNA',amount:'0',description:'Synthetic authorisation'},{code:'PVC'},{description:'Changed'},{amount:'123.4501'},{vat:'0.01'},{extras:[]},{date:'2026-10-13'},{kind:'OTHER'}])assert.throws(()=>netcashReceiptSource(statement,hash(statement),{date:'2026-10-14',opening:'0',closing:'123.45'},{...line,...changed}),/SOURCE_INTEGRITY/);
});
test('Netcash metadata cannot replace an unbalanced, changed, missing or wrong-day original source',()=>{
 for(const raw of ['synthetic metadata only',statement.replace('Closing\t123.45','Closing\t124.45'),statement.replace('20261014\tPNC','20261013\tPNC')])assert.throws(()=>netcashReceiptSource(raw,hash(raw),{date:'2026-10-14',opening:'0',closing:'123.45'},line),/SOURCE_INTEGRITY/);
 assert.throws(()=>netcashReceiptSource(statement,hash(statement+'changed'),{date:'2026-10-14',opening:'0',closing:'123.45'},line),/SOURCE_INTEGRITY/);
});

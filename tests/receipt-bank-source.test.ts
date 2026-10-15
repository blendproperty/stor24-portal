import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {prepareBankSourceIdentity,privateBankSourceIdentity,readBankSourceIdentity,receiptSourceHash} from '../src/lib/receipt-bank-source-policy';
test('retained JSON evidence hashes survive object-key reordering while retaining array order, field types and values',()=>{
 assert.equal(receiptSourceHash({a:1,b:{x:'100.25',y:'ZAR'},c:[1,2]}),receiptSourceHash({c:[1,2],b:{y:'ZAR',x:'100.25'},a:1}));
 for(const value of [{a:1,b:{x:100.25,y:'ZAR'},c:[1,2]},{a:1,b:{x:'100.25',y:'USD'},c:[1,2]},{a:1,b:{x:'100.25',y:'ZAR'},c:[2,1]},{a:1,b:{x:'100.26',y:'ZAR'},c:[1,2]}])assert.notEqual(receiptSourceHash(value),receiptSourceHash({a:1,b:{x:'100.25',y:'ZAR'},c:[1,2]}));
});
test('incoming bank identity is encrypted, org-bound, tamper-evident and stable across display aliases and zero padding',()=>{
 const previousSigning=process.env.AUTH_SECRET,previousVault=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;
 process.env.AUTH_SECRET=randomBytes(32).toString('hex');process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
 try{
  const input={bankCode:'ABCDZAJJ',accountNumber:'00123456789',label:'Synthetic incoming bank',requestKey:randomUUID(),reference:'Synthetic original source',confirmed:true};
  const first=prepareBankSourceIdentity(input,randomUUID(),'synthetic-org'),second=prepareBankSourceIdentity({...input,accountNumber:'123456789',label:'Changed alias'},randomUUID(),'synthetic-org');
  assert.equal(first.bankIdentityHash,second.bankIdentityHash);assert.notEqual(first.identityEncrypted,second.identityEncrypted);assert.ok(!first.identityEncrypted.includes(input.accountNumber));
  assert.deepEqual(privateBankSourceIdentity(first),{bankCode:input.bankCode,accountNumber:input.accountNumber});
  assert.notEqual(prepareBankSourceIdentity(input,randomUUID(),'foreign-org').bankIdentityHash,first.bankIdentityHash);
  for(const patch of [{organisationId:'foreign-org'},{label:'Changed label'},{bankCode:'WXYZZAJJ'},{accountSuffix:'6780'},{bankIdentityHash:'f'.repeat(64)},{identityEncrypted:second.identityEncrypted}])assert.throws(()=>readBankSourceIdentity({...first,...patch}),/INTEGRITY/);
  for(const bank of [{bankCode:'INVALID'},{accountNumber:'00000'},{accountNumber:'12 345'}])assert.throws(()=>prepareBankSourceIdentity({...input,...bank},randomUUID(),'synthetic-org'));
 }finally{if(previousSigning===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=previousSigning;if(previousVault===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=previousVault;}
});

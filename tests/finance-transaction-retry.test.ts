import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma} from '../src/generated/prisma/client';
import {retryRolledBackFinanceTransaction,confirmedFinanceRollback} from '../src/lib/finance/retry-rolled-back-transaction';
const known=(code:string)=>new Prisma.PrismaClientKnownRequestError('Synthetic transaction error',{code,clientVersion:'synthetic'});
test('only explicit Prisma transaction rollbacks rerun the complete decision and stop after three attempts',async()=>{
 let calls=0;const value=await retryRolledBackFinanceTransaction(async()=>{calls++;if(calls<3)throw known('P2034');return 'fresh proof committed';});
 assert.equal(calls,3);assert.equal(value,'fresh proof committed');
 const failure=known('P2034');calls=0;await assert.rejects(retryRolledBackFinanceTransaction(async()=>{calls++;throw failure;}),error=>error===failure);assert.equal(calls,3);
});

test('observed pg adapter raw serialization/deadlock rollbacks are exact structured matches, never message guesses',async()=>{
 const raw=(originalCode:unknown='40001',kind='TransactionWriteConflict',code='P2010')=>new Prisma.PrismaClientKnownRequestError('Synthetic raw query error',{code,clientVersion:'synthetic',meta:{driverAdapterError:{cause:{originalCode,kind}}}});
 for(const state of ['40001','40P01']){const error=raw(state);assert.equal(confirmedFinanceRollback(error),true);let calls=0;assert.equal(await retryRolledBackFinanceTransaction(async()=>{if(++calls<3)throw error;return'committed once';}),'committed once');assert.equal(calls,3);}
 for(const error of [raw('23505'),raw('57014'),raw('40001','UnknownError'),raw(40001),raw('40001','TransactionWriteConflict','P2028'),known('P2010'),{code:'P2010',meta:{driverAdapterError:{cause:{originalCode:'40001',kind:'TransactionWriteConflict'}}}},new Prisma.PrismaClientKnownRequestError('40001 TransactionWriteConflict',{code:'P2010',clientVersion:'synthetic'})]){assert.equal(confirmedFinanceRollback(error),false);let calls=0;await assert.rejects(retryRolledBackFinanceTransaction(async()=>{calls++;throw error;}),value=>value===error);assert.equal(calls,1);}
});
test('timeouts, unknown commit results, duplicate keys, policy holds and code-shaped objects are never replayed',async()=>{
 for(const failure of [known('P2028'),known('P2002'),known('P1001'),Error('Unknown commit outcome'),Error('ADJUSTMENT_CHANGED'),{code:'P2034'}]){
  let calls=0;await assert.rejects(retryRolledBackFinanceTransaction(async()=>{calls++;throw failure;}),error=>error===failure);assert.equal(calls,1);
 }
});
test('a fresh source or revision hold after rollback stops immediately instead of persisting the old decision',async()=>{
 let calls=0;const changed=Error('COLLECTION_CHANGED');
 await assert.rejects(retryRolledBackFinanceTransaction(async()=>{if(++calls===1)throw known('P2034');throw changed;}),error=>error===changed);assert.equal(calls,2);
});

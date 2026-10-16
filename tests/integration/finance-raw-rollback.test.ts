import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import {confirmedFinanceRollback,retryRolledBackFinanceTransaction} from '../../src/lib/finance/retry-rolled-back-transaction';
import {withRawRollbackFixture} from './finance-raw-rollback-fixture';
test('native pg raw conflicts rerun a completely rolled-back transaction only and retain a strict three-attempt cap',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'localhost');assert.match(url.pathname,/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/);
 const table='raw_effect_'+randomUUID().replaceAll('-','');
 await db.$executeRawUnsafe(`CREATE TABLE "${table}" (id integer PRIMARY KEY,effects integer NOT NULL)`);
 try{
  await db.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (1,0)`);
  const effects=async()=>Number((await db.$queryRawUnsafe<{effects:number}[]>(`SELECT effects FROM "${table}" WHERE id=1`))[0].effects);
  for(const state of ['40001','40P01'] as const)await t.test(state+' restarts all writes and commits one effect',async()=>{
   await db.$executeRawUnsafe(`UPDATE "${table}" SET effects=0`);
   const result=await withRawRollbackFixture(state,2,query=>retryRolledBackFinanceTransaction(()=>db.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "${table}" SET effects=effects+1`);await tx.$queryRawUnsafe(query);return'committed';},{isolationLevel:'Serializable'})));
   assert.equal(result.value,'committed');assert.equal(result.attempts,3);assert.equal(await effects(),1);
  });
  await t.test('exhausted raw rollback and native cancellation preserve zero effects',async()=>{
   for(const [state,expected]of [['40001',3],['57014',1]]as const){
    await db.$executeRawUnsafe(`UPDATE "${table}" SET effects=0`);
    const result=await withRawRollbackFixture(state,3,async query=>{let calls=0;await assert.rejects(retryRolledBackFinanceTransaction(()=>{calls++;return db.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "${table}" SET effects=effects+1`);await tx.$queryRawUnsafe(query);});}),error=>confirmedFinanceRollback(error)===(state==='40001'));return calls;});
    assert.equal(result.value,expected);assert.equal(result.attempts,expected);assert.equal(await effects(),0);
   }
  });
 }finally{await db.$executeRawUnsafe(`DROP TABLE "${table}"`);await db.$disconnect();}
});

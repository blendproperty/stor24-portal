import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import assert from 'node:assert/strict';
import {Prisma} from '../../src/generated/prisma/client';

/** Observe a real completed pg rollback, then revoke the real database role
 * before the production helper starts its next full attempt. No error is
 * fabricated and no production retry/backoff is patched. */
export async function rejectAfterFinanceRoleRevocation(userId:string,run:()=>Promise<unknown>,expectedTransactions:1|2=2){
 const url=new URL(process.env.DATABASE_URL!);
 if(process.env.MERCHANDISE_DB_TEST!=='isolated-ci'||url.hostname!=='localhost'||!/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/.test(url.pathname)||!/^[a-z0-9]+$/.test(userId))throw Error('Synthetic authority-revocation fixture refused');
 const original=db.$transaction;let attempts=0,revoked=false;
 db.$transaction=(async(...args:unknown[])=>{
  attempts++;
  try{return await Reflect.apply(original,db,args)}catch(error){
   if(!revoked&&error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2034'){
    assert.ok((await db.roleAssignment.deleteMany({where:{userId}})).count>0);revoked=true;
   }
   throw error;
  }
 }) as typeof db.$transaction;
 try{await assert.rejects(run,/FORBIDDEN/);assert.equal(revoked,true);assert.equal(attempts,expectedTransactions);return{attempts,revoked}}
 finally{db.$transaction=original}
}

/** Sequence increments survive rollback, proving the actual PostgreSQL abort
 * and the number of full attempts. Trigger affects only this synthetic org. */
export async function withFinanceSerializationFailure<T>(organisationId:string,action:string,failures:number,run:()=>Promise<T>){
 if(process.env.MERCHANDISE_DB_TEST!=='isolated-ci'||new URL(process.env.DATABASE_URL!).hostname!=='localhost'||!/^[a-z\d]+$/i.test(organisationId)||!/^[a-z_.-]+$/.test(action)||!Number.isInteger(failures)||failures<1||failures>3)throw Error('Synthetic serialization fixture refused');
 const name='ci_finance_'+randomUUID().replaceAll('-',''),sequence=name+'_seq';
 await db.$executeRawUnsafe(`CREATE SEQUENCE "${sequence}"`);
 try{
  await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organisationId"='${organisationId}' AND NEW.action='${action}' THEN IF nextval('${sequence}')<=${failures} THEN RAISE EXCEPTION 'Synthetic explicit serialization rollback' USING ERRCODE='40001'; END IF; END IF; RETURN NEW; END; $$`);
  try{
   await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
   try{const value=await run(),count=await db.$queryRawUnsafe<{last_value:bigint}[]>(`SELECT last_value FROM "${sequence}"`);return{value,attempts:Number(count[0].last_value)};}
   finally{await db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "AuditEvent"`);}
  }finally{await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);}
 }finally{await db.$executeRawUnsafe(`DROP SEQUENCE "${sequence}"`);}
}

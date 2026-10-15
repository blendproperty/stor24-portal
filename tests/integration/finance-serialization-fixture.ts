import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';

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

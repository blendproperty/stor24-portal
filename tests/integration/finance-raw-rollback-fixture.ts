import {randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
/** Native SQL errors on this owned test database, without message parsing or
 * mocked Prisma errors. The sequence survives rollback and bounds attempts. */
export async function withRawRollbackFixture<T>(state:'40001'|'40P01'|'57014',failures:number,run:(query:string)=>Promise<T>){
 const url=new URL(process.env.DATABASE_URL!);
 if(process.env.MERCHANDISE_DB_TEST!=='isolated-ci'||url.hostname!=='localhost'||!/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/.test(url.pathname)||!['40001','40P01','57014'].includes(state)||!Number.isInteger(failures)||failures<1||failures>3)throw Error('Synthetic raw rollback fixture refused');
 const name='raw_finance_'+randomUUID().replaceAll('-',''),sequence=name+'_seq';
 await db.$executeRawUnsafe(`CREATE SEQUENCE "${sequence}"`);
 try{
  await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN IF nextval('${sequence}')<=${failures} THEN RAISE EXCEPTION 'Synthetic native transaction rollback' USING ERRCODE='${state}'; END IF; RETURN 1; END $$`);
  try{const value=await run(`SELECT "${name}"()`),rows=await db.$queryRawUnsafe<{last_value:bigint}[]>(`SELECT last_value FROM "${sequence}"`);return{value,attempts:Number(rows[0].last_value)};}
  finally{await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);}
 }finally{await db.$executeRawUnsafe(`DROP SEQUENCE "${sequence}"`);}
}

import {PrismaClientKnownRequestError} from '@prisma/client/runtime/client';

/** Prisma 7's pg adapter wraps raw-query rollback errors as P2010 rather
 * than P2034. Match only its observed structured SQLSTATE and conflict kind;
 * messages, arbitrary P2010 errors, timeouts and code-shaped objects confer
 * no replay authority. Unknown/new adapter representations fail closed.
 * PostgreSQL 16 documents 40001/40P01 as retryable full-transaction aborts:
 * https://www.postgresql.org/docs/16/mvcc-serialization-failure-handling.html
 */
export function confirmedFinanceRollback(error:unknown){
 if(!(error instanceof PrismaClientKnownRequestError))return false;
 if(error.code==='P2034')return true;
 if(error.code!=='P2010')return false;
 const adapter=error.meta?.driverAdapterError;
 if(!adapter||typeof adapter!=='object'||!('cause'in adapter))return false;
 const cause=adapter.cause;
 return !!cause&&typeof cause==='object'&&'kind'in cause&&cause.kind==='TransactionWriteConflict'&&'originalCode'in cause&&typeof cause.originalCode==='string'&&['40001','40P01'].includes(cause.originalCode);
}

/** Only for callbacks whose entire effects are inside one database transaction.
 * After a confirmed rollback, all account locks, proofs, revisions and
 * writes run again from the beginning. Never wrap a bank/provider call,
 * external send, timeout, or an unknown commit outcome with this helper.
 * Three total attempts; existing transaction isolation/timeouts stay unchanged.
 */
export async function retryRolledBackFinanceTransaction<T>(transaction:()=>Promise<T>):Promise<T>{
 for(let attempt=0;;attempt++){
  try{return await transaction();}
  catch(error){
   if(attempt>=2||!confirmedFinanceRollback(error))throw error;
   // Give the conflicting transaction time to finish before taking a new
   // snapshot. This does not extend or reinterpret a transaction timeout.
   await new Promise<void>(resolve=>setTimeout(resolve,20*(attempt+1)));
  }
 }
}

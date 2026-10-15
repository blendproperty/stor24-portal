import {Prisma} from '@/generated/prisma/client';

/** Only for callbacks whose entire effects are inside one database transaction.
 * P2034 is an explicit rollback, so all account locks, proofs, revisions and
 * writes must run again from the beginning. Never wrap a bank/provider call,
 * external send, timeout, or an unknown commit outcome with this helper.
 * Three total attempts; existing transaction isolation/timeouts stay unchanged.
 */
export async function retryRolledBackFinanceTransaction<T>(transaction:()=>Promise<T>):Promise<T>{
 for(let attempt=0;;attempt++){
  try{return await transaction();}
  catch(error){
   if(attempt>=2||!(error instanceof Prisma.PrismaClientKnownRequestError)||error.code!=='P2034')throw error;
   // Give the conflicting transaction time to finish before taking a new
   // snapshot. This does not extend or reinterpret a transaction timeout.
   await new Promise<void>(resolve=>setTimeout(resolve,20*(attempt+1)));
  }
 }
}

import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { userRemovalDependencies } from '../src/lib/staff-user-removal';
async function main(){
if(process.env.MERCHANDISE_DB_TEST!=="isolated-ci" || new URL(process.env.DATABASE_URL!).hostname!=="localhost") throw Error("ISOLATED_TEST_DATABASE_REQUIRED");
const key=randomUUID(),org=await db.organisation.create({data:{name:'Race synthetic',slug:key}}),user=await db.user.create({data:{organisationId:org.id,name:'Race',email:`${key}@example.invalid`,active:false}});
let ready!:()=>void,resume!:()=>void;const reached=new Promise<void>(r=>ready=r),release=new Promise<void>(r=>resume=r);
const removal=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id} FOR UPDATE`;const deps=await userRemovalDependencies(tx,user.id);if(deps.length)throw Error('unexpected dependency');ready();await release;await tx.user.delete({where:{id:user.id}});},{isolationLevel:'Serializable',timeout:20000});
await reached;await db.configurationProfile.create({data:{organisationId:org.id,domain:'CI',name:key,config:{reviewerId:user.id}}});resume();
try{await removal;console.log('RACE: deletion and concurrent non-FK JSON reference both committed');}catch(e){console.log('deletion blocked',e instanceof Error?e.message:'unknown');}
await db.$disconnect();
}
main().catch(e=>{console.error(e);process.exitCode=1});

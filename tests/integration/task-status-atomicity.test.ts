import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";

test("isolated PostgreSQL task status and audit commit together", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
  const key=randomUUID();
  const org=await db.organisation.create({data:{name:"Task audit CI",slug:key}});
  const user=await db.user.create({data:{organisationId:org.id,name:"Synthetic operator",email:`${key}@example.invalid`}});
  const task=await db.task.create({data:{organisationId:org.id,title:"Synthetic task",status:"OPEN"}});
  const output=await build({entryPoints:["src/app/api/v1/operations/tasks/[id]/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"fixture",setup(b){
    b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>__auth;export const authErrorResponse=()=>Response.json({error:'synthetic failure'},{status:500});"}));
  }}]});
  const loaded={exports:{} as {PATCH:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>}};
  new Function('require','module','exports','__db','__auth',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,{organisationId:org.id,user:{id:user.id}});
  const send=(status:string)=>loaded.exports.PATCH(new Request('https://example.invalid/task',{method:'PATCH',body:JSON.stringify({status})}),{params:Promise.resolve({id:task.id})});
  let constrained=false;
  try {
    for(const status of ['COMPLETED','OPEN']) {
      const before=await db.task.findUniqueOrThrow({where:{id:task.id}});
      const count=await db.auditEvent.count({where:{entityId:task.id}});
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_task_audit_failure CHECK (false) NOT VALID');constrained=true;
      assert.equal((await send(status)).status,500);
      assert.deepEqual(await db.task.findUniqueOrThrow({where:{id:task.id}}),before);
      assert.equal(await db.auditEvent.count({where:{entityId:task.id}}),count);
      await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_task_audit_failure');constrained=false;
      const response=await send(status);assert.equal(response.status,200);
      const saved=await db.task.findUniqueOrThrow({where:{id:task.id}});assert.equal(saved.status,status);
      assert.equal(Boolean(saved.completedAt),status==='COMPLETED');
      assert.equal(await db.auditEvent.count({where:{entityId:task.id}}),count+1);
      assert.deepEqual((await response.json()).data,JSON.parse(JSON.stringify(saved)));
    }
  }finally{if(constrained)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_task_audit_failure');await db.$disconnect();}
});

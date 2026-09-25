import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("task status and audit roll back together and allow a verified retry", async () => {
  const state = { task: { id: "task", organisationId: "org", facilityId: "facility", status: "OPEN", completedAt: null as Date | null }, audits: [] as unknown[], failAudit: true };
  const client = (s: typeof state) => ({ task: {
    findFirst: async () => s.task,
    update: async ({data}: {data: {status:string;completedAt:Date|null}}) => (s.task={...s.task,...data}),
  }, auditEvent: {create: async ({data}: {data: unknown}) => {if(state.failAudit) throw new Error("SYNTHETIC_AUDIT_FAILURE");s.audits.push(data);return data;}} });
  const database = {...client(state),$transaction:async (fn:(tx:ReturnType<typeof client>)=>Promise<unknown>)=>{const pending=structuredClone(state);const result=await fn(client(pending));state.task=pending.task;state.audits=pending.audits;return result;}};
  const output=await build({entryPoints:["src/app/api/v1/operations/tasks/[id]/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"fixture",setup(b){
    b.onResolve({filter:/^@\/lib\/(db|auth-guards)$/},a=>({path:a.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith('/db')?'export const db=__db;':"export const requirePermission=async()=>({organisationId:'org',user:{id:'actor'}});export const authErrorResponse=e=>Response.json({error:e.message},{status:500});"}));
  }}]});
  const loaded={exports:{} as {PATCH:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>}};
  new Function('require','module','exports','__db',output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,database);
  const send=()=>loaded.exports.PATCH(new Request('https://example.invalid/task',{method:'PATCH',body:JSON.stringify({status:'COMPLETED'})}),{params:Promise.resolve({id:'task'})});
  const before=structuredClone(state.task);assert.equal((await send()).status,500);assert.deepEqual(state.task,before);assert.equal(state.audits.length,0);
  state.failAudit=false;assert.equal((await send()).status,200);assert.equal(state.task.status,'COMPLETED');assert.equal(state.audits.length,1);
});

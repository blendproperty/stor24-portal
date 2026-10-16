import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { operationsTaskPage } from "../../src/lib/operations-task-service";
import { db } from "../../src/lib/db";

test("isolated PostgreSQL task status and audit commit together", async t => {
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
    await t.test("complete scoped filters and pagination reach tasks beyond the legacy hundred", async () => {
      const a = await db.facility.create({ data: { organisationId: org.id, name: "Task store A", code: "A" } });
      const b = await db.facility.create({ data: { organisationId: org.id, name: "Task store B", code: "B" } });
      const colleague = await db.user.create({ data: { organisationId: org.id, name: "Later assigned person", email: `${randomUUID()}@example.invalid` } });
      const privateColleague = await db.user.create({ data: { organisationId: org.id, name: "Other store only", email: `${randomUUID()}@example.invalid` } });
      const foreign = await db.organisation.create({ data: { name: "Other task org", slug: randomUUID() } });
      const foreignStore = await db.facility.create({ data: { organisationId: foreign.id, name: "Other org store", code: "X" } });
      const scope = { organisationId: org.id, userId: user.id, facilityIds: [a.id], unrestrictedFacilities: false }, now = new Date("2026-10-16T09:00:00Z");
      await db.task.createMany({ data: Array.from({ length: 112 }, (_, index) => ({ organisationId: org.id, facilityId: a.id, title: `Page fixture ${index}`, assigneeId: index === 110 ? colleague.id : user.id, dueAt: new Date(Date.parse("2026-10-16T07:00:00Z") + index * 60000) })) });
      const otherStoreTask = await db.task.create({ data: { organisationId: org.id, facilityId: b.id, title: "Page fixture other store", assigneeId: privateColleague.id } });
      await db.task.create({ data: { organisationId: foreign.id, facilityId: foreignStore.id, title: "Page fixture other org" } });
      const auditsBefore = await db.auditEvent.count({ where: { organisationId: org.id } });
      const first = await operationsTaskPage(scope, { q: "Page fixture" }, now);
      assert.equal(first.total, 112); assert.equal(first.items.length, 25); assert.ok(first.nextCursor);
      assert.equal(first.facilities.some(store => store.id === b.id || store.id === foreignStore.id), false);
      assert.equal(first.assignees.some(person => person.id === privateColleague.id), false);
      const seen = new Set(first.items.map(item => item.id)); let cursor = first.nextCursor;
      while (cursor) { const page = await operationsTaskPage(scope, { q: "Page fixture", cursor }, now); assert.equal(page.total, 112); for (const item of page.items) { assert.equal(seen.has(item.id), false); seen.add(item.id); } cursor = page.nextCursor; }
      assert.equal(seen.size, 112);
      const later = await operationsTaskPage(scope, { q: "Page fixture", assignee: colleague.id }, now); assert.equal(later.total, 1); assert.equal(later.items[0].title, "Page fixture 110");
      assert.equal((await operationsTaskPage(scope, { q: "Page fixture", assignee: "mine" }, now)).total, 111);
      assert.equal((await operationsTaskPage(scope, { assignee: "search", person: "Later assigned" }, now)).total, 1);
      for (const cursor of [otherStoreTask.id, "cm00000000000000000000099"]) await assert.rejects(operationsTaskPage(scope, { q: "Page fixture", cursor }, now), /CONFLICT/);
      await assert.rejects(operationsTaskPage(scope, { facility: b.id }, now), /FORBIDDEN/); await assert.rejects(operationsTaskPage(scope, { facility: "portfolio" }, now), /FORBIDDEN/);
      await db.task.update({ where: { id: first.nextCursor! }, data: { status: "COMPLETED" } });
      await assert.rejects(operationsTaskPage(scope, { q: "Page fixture", cursor: first.nextCursor! }, now), /CONFLICT/);
      await db.task.createMany({ data: [
        { organisationId: org.id, facilityId: a.id, title: "Window fixture start", assigneeId: user.id, dueAt: new Date("2026-10-15T22:00:00Z") },
        { organisationId: org.id, facilityId: a.id, title: "Window fixture future", assigneeId: user.id, status: "WAITING", dueAt: new Date("2026-10-16T22:00:00Z") },
        { organisationId: org.id, facilityId: a.id, title: "Window fixture completed", assigneeId: user.id, status: "COMPLETED", dueAt: new Date("2026-10-16T07:00:00Z") },
        { organisationId: org.id, facilityId: a.id, title: "Window fixture cancelled", assigneeId: user.id, status: "CANCELLED", dueAt: new Date("2026-10-16T07:00:00Z") },
        { organisationId: org.id, facilityId: a.id, title: "Window fixture undated" },
      ] });
      assert.equal((await operationsTaskPage(scope, { q: "Window fixture", due: "today" }, now)).total, 1);
      assert.equal((await operationsTaskPage(scope, { q: "Window fixture", due: "today", status: "all" }, now)).total, 3);
      assert.equal((await operationsTaskPage(scope, { q: "Window fixture", due: "overdue", status: "all" }, now)).total, 1);
      assert.equal((await operationsTaskPage(scope, { q: "Window fixture", due: "upcoming" }, now)).total, 1);
      assert.equal((await operationsTaskPage(scope, { q: "Window fixture", assignee: "unassigned", due: "undated" }, now)).total, 1);
      assert.equal((await operationsTaskPage(scope, { q: "Window fixture", status: "COMPLETED" }, now)).total, 1);
      assert.equal((await operationsTaskPage(scope, { q: "Window fixture", due: "today" }, new Date("2026-10-16T22:00:00Z"))).total, 1);
      assert.equal(await db.auditEvent.count({ where: { organisationId: org.id } }), auditsBefore);
    });
  }finally{if(constrained)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_task_audit_failure');await db.$disconnect();}
});

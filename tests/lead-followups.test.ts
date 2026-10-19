import assert from "node:assert/strict";
import test from "node:test";
import { leadFollowupWhere } from "../src/lib/lead-followup-policy";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("manager lead reminder uses the SAST day boundary, excludes closed/converted leads and null dates", () => {
  const where = leadFollowupWhere(new Date("2026-10-19T21:59:59Z"));
  assert.equal(where.nextActionAt.lt.toISOString(), "2026-10-19T22:00:00.000Z");
  assert.deepEqual(where.stage.notIn, ["WON","LOST"]);
  assert.equal(where.reservations.none.status,"CONVERTED");
  assert.deepEqual(where.reservations.none.convertedTenancy.status.in,["ACTIVE","NOTICE_GIVEN"]);
  assert.equal(leadFollowupWhere(new Date("2026-10-19T22:00:00Z")).nextActionAt.lt.toISOString(),"2026-10-20T22:00:00.000Z");
});

test("lead needed-date validation allows editing/clearing, rejects impossible dates and preserves old callers",async()=>{
  const output=await build({entryPoints:["src/lib/leads-workspace-service.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"schema-only",setup(b){b.onResolve({filter:/^@\/generated\/prisma\/client$/},()=>({path:"prisma",namespace:"prisma"}));b.onLoad({filter:/.*/,namespace:"prisma"},()=>({contents:"export const Prisma={DbNull:null};"}));b.onResolve({filter:/^@\/lib\/db$/},()=>({path:"db",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const db={};"}));}}]});
  const loaded={exports:{} as {leadUpdateSchema:{safeParse:(v:unknown)=>{success:boolean}}}};
  new Function("require","module","exports",output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
  const input={updatedAt:"2026-10-19T10:00:00Z",stage:"NEW",notes:"Call back",assignedToId:null,nextActionAt:null};
  for(const value of [input,{...input,expectedMoveIn:null},{...input,expectedMoveIn:"2026-11-01"}])assert.equal(loaded.exports.leadUpdateSchema.safeParse(value).success,true);
  for(const expectedMoveIn of ["2026-02-30","tomorrow","2026-11-01T00:00:00Z"])assert.equal(loaded.exports.leadUpdateSchema.safeParse({...input,expectedMoveIn}).success,false);
});

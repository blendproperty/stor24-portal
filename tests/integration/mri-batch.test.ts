import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { emptyMriMapping } from "../../src/lib/mri-mapping-policy";
import { changeMriMapping, mriMappingReview } from "../../src/lib/mri-mapping-service";
import { mriBatchReview, saveMriBatch, transitionMriBatch, mriBatchCsv } from "../../src/lib/mri-batch-service";
import type { SandboxSource } from "../../src/lib/mri-batch-policy";
test("isolated sandbox journal snapshots, independent review, duplicates and audit rollback", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
  const fixture = async (approve = true) => {
    const org = await db.organisation.create({data:{name:"Batch CI",slug:randomUUID()}});
    const users = await Promise.all([0,1,2].map(i=>db.user.create({data:{organisationId:org.id,name:`Batch CI ${i}`,email:randomUUID()+"@example.invalid"}})));
    const [a,b,c] = users.map(u=>({organisationId:org.id,userId:u.id,unrestrictedFacilities:true,facilityIds:[]}));
    if (approve) {
      const mapping = {...emptyMriMapping(),entityCode:"TEST",propertyCode:"TEST",basis:"ACCRUAL" as const,scopeNotes:"Synthetic ledger, no production source",rules:emptyMriMapping().rules.map(r=>({...r,debitAccount:"TEST-DR",creditAccount:"TEST-CR",taxTreatment:"NO_TAX" as const,rationale:"Synthetic signs and categories"}))};
      const saved=await changeMriMapping(a,{action:"save",revision:null,mapping},"sandbox"); const submitted=await changeMriMapping(a,{action:"submit",revision:saved.revision},"sandbox"); await changeMriMapping(c,{action:"approve",revision:submitted.revision,approvalReference:"CI reviewed"},"sandbox");
    }
    const source:SandboxSource={origin:"SANDBOX_MANUAL",currency:"ZAR",rows:[{sourceKey:"CI-CHARGE",movement:"CHARGE",category:"charge",amount:"115.00",taxAmount:"0.00",reversalOf:null}]};
    return {a,b,c,source};
  };
  const nativeFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("No provider operations allowed")};
  try {
    await t.test("drafts can be saved with undecided mappings; primary and sandbox mappings isolate",async()=>{
      const f=await fixture(false),draft=await saveMriBatch(f.a,{period:"2026-01",revision:null,source:f.source}); assert.ok(draft.blockers.length);assert.equal(draft.status,"DRAFT");assert.equal(draft.postingEnabled,false);
      await assert.rejects(transitionMriBatch(f.a,{action:"submit",period:draft.period,revision:draft.revision,reference:"CI review"}),/MRI_BATCH_BLOCKED/);
      const ready=await fixture();assert.equal((await mriMappingReview(ready.a)).revision,null);assert.equal((await mriMappingReview(ready.a,"sandbox")).status,"APPROVED");
    });
    await t.test("balanced closed-period snapshots require an independent reviewer and are immutable after approval",async()=>{
      const f=await fixture(),draft=await saveMriBatch(f.a,{period:"2026-01",revision:null,source:f.source});assert.equal(draft.preview?.debitTotal,"115.00");assert.deepEqual(draft.blockers,[]);
      const submitted=await transitionMriBatch(f.a,{action:"submit",period:draft.period,revision:draft.revision,reference:"CI submit"});
      await assert.rejects(transitionMriBatch(f.a,{action:"approve",period:draft.period,revision:submitted.revision,reference:"CI self"}),/MRI_BATCH_SELF_APPROVAL/);
      const approved=await transitionMriBatch(f.b,{action:"approve",period:draft.period,revision:submitted.revision,reference:"CI independent"}); assert.equal(approved.snapshotHash,draft.snapshotHash);
      const csv=await mriBatchCsv(f.a,approved.period,approved.revision!);assert.match(csv,/NOT AN MRI IMPORT/);assert.equal(await mriBatchCsv(f.a,approved.period,approved.revision!),csv);
      await assert.rejects(saveMriBatch(f.a,{period:approved.period,revision:approved.revision,source:f.source}),/MRI_BATCH_IMMUTABLE/);
      await assert.rejects(transitionMriBatch(f.a,{action:"reopen",period:approved.period,revision:approved.revision,reference:"CI immutable"}),/MRI_BATCH_IMMUTABLE/);
      await assert.rejects(mriBatchCsv(f.a,approved.period,submitted.revision!),/MRI_BATCH_CHANGED/);
      const voided=await transitionMriBatch(f.a,{action:"void",period:approved.period,revision:approved.revision,reference:"CI void local"}); assert.equal(voided.snapshotHash,approved.snapshotHash);assert.equal(voided.status,"VOID");
      assert.equal(await db.ledgerEntry.count({where:{account:{customer:{organisationId:f.a.organisationId}}}}),0);assert.equal(await db.webhookOutbox.count({where:{organisationId:f.a.organisationId}}),0);
    });
    await t.test("changed mapping blocks approvals and approved review downloads",async()=>{
      const f=await fixture(),draft=await saveMriBatch(f.a,{period:"2026-01",revision:null,source:f.source});const submitted=await transitionMriBatch(f.a,{action:"submit",period:draft.period,revision:draft.revision,reference:"CI submit"});
      const current=await mriMappingReview(f.a,"sandbox");await changeMriMapping(f.a,{action:"save",revision:current.revision,mapping:current.mapping},"sandbox");
      await assert.rejects(transitionMriBatch(f.b,{action:"approve",period:draft.period,revision:submitted.revision,reference:"CI changed"}),/MRI_BATCH_BLOCKED/);
      assert.equal((await mriBatchReview(f.a,draft.period)).mappingCurrent,false);
    });
    await t.test("concurrent drafts cannot overwrite and submitted source keys cannot be consumed by another period",async()=>{
      const f=await fixture(),results=await Promise.allSettled([saveMriBatch(f.a,{period:"2026-01",revision:null,source:f.source}),saveMriBatch(f.b,{period:"2026-01",revision:null,source:f.source})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      const draft=await mriBatchReview(f.a,"2026-01");await transitionMriBatch(f.a,{action:"submit",period:draft.period,revision:draft.revision,reference:"CI submit"});
      const later=await saveMriBatch(f.a,{period:"2026-02",revision:null,source:f.source});await assert.rejects(transitionMriBatch(f.a,{action:"submit",period:later.period,revision:later.revision,reference:"CI duplicate"}),/MRI_BATCH_DUPLICATE_SOURCE/);
      assert.equal((await mriBatchReview(f.a,later.period)).status,"DRAFT");
    });
    await t.test("scope, audit failure and tampered snapshots fail closed",async()=>{
      const f=await fixture(),other=await fixture();await assert.rejects(saveMriBatch({...f.a,unrestrictedFacilities:false},{period:"2026-01",revision:null,source:f.source}),/MRI_ORG_PERMISSION/);
      await assert.rejects(saveMriBatch({...f.a,userId:"CI-missing-actor"},{period:"2026-01",revision:null,source:f.source}));assert.equal((await mriBatchReview(f.a,"2026-01")).revision,null);
      const draft=await saveMriBatch(f.a,{period:"2026-01",revision:null,source:f.source});await assert.rejects(saveMriBatch(other.a,{period:"2026-01",revision:draft.revision,source:f.source}),/MRI_BATCH_CHANGED/);
      const row=await db.configurationProfile.findUniqueOrThrow({where:{id:`mri-sandbox-batch:${f.a.organisationId}:2026-01`}});const config=JSON.parse(JSON.stringify(row.config));config.source.rows[0].amount="999.00";await db.configurationProfile.update({where:{id:row.id},data:{config}});
      await assert.rejects(mriBatchReview(f.a,"2026-01"),/MRI_BATCH_INTEGRITY/);
    });
  } finally {globalThis.fetch=nativeFetch;await db.$disconnect();}
});

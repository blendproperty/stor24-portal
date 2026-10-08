import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {defaultVisualQuery} from "../../src/lib/visual-report-engine";
import {visualReportSchema,visualReportDatasets} from "../../src/lib/visual-report-contract";
import {saveVisualReport,scheduleVisualReport} from "../../src/lib/visual-report-service";
import {runScheduledReports} from "../../src/lib/visual-report-worker";
import {visualReportSource} from "../../src/lib/visual-report-data";
import {decryptReportArtifact,encryptReportArtifact,visualReportScope} from "../../src/lib/visual-report-security";

test("isolated PostgreSQL reporting persistence, claims, expiry and history scope",async t=>{
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname,"localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY="synthetic-reporting-test-key-only";
  process.env.REPORT_CRON_SECRET_SHA256="a".repeat(64);
  const key=randomUUID(),org=await db.organisation.create({data:{name:"Reporting CI only",slug:key}});
  try {
    const facility=await db.facility.create({data:{organisationId:org.id,name:"Reporting fixture store",code:key}});
    const other=await db.facility.create({data:{organisationId:org.id,name:"Other fixture store",code:randomUUID()}});
    const role=await db.role.create({data:{organisationId:org.id,name:"Reporting fixture",permissions:["reports.view","reports.export","reports.schedule"]}});
    const user=await db.user.create({data:{organisationId:org.id,email:`${key}@example.invalid`,name:"Synthetic employee",roleAssignments:{create:{roleId:role.id,facilityId:facility.id}}},include:{roleAssignments:{include:{role:true}}}});
    const actor={user} as Parameters<typeof saveVisualReport>[0];
    const query=visualReportSchema.parse({...defaultVisualQuery("units","2026-10-01","2026-10-31"),facilityId:facility.id,columns:["facility","unit"]});
    const input={kind:"save" as const,query,visibility:"PRIVATE" as const,requestKey:randomUUID()};
    const [saved,retry]=await Promise.all([saveVisualReport(actor,input),saveVisualReport(actor,input)]);
    await t.test("concurrent retries store one audited definition and stale revisions conflict",async()=>{
      assert.equal(saved.id,retry.id);assert.equal(await db.savedReport.count({where:{organisationId:org.id}}),1);
      assert.equal(await db.auditEvent.count({where:{entityId:saved.id,action:"report.definition.created"}}),1);
      await saveVisualReport(actor,{...input,id:saved.id,revision:1});
      await assert.rejects(saveVisualReport(actor,{...input,id:saved.id,revision:1}),/REPORT_CONFLICT/);
    });
    const schedule=await scheduleVisualReport(actor,saved.id,"daily"),now=new Date();
    await db.reportSchedule.update({where:{id:schedule.id},data:{nextRunAt:new Date(now.getTime()-1000)}});
    await t.test("concurrent workers claim one encrypted snapshot",async()=>{
      const results=await Promise.all([runScheduledReports(now),runScheduledReports(now)]);
      assert.equal(results.reduce((n,r)=>n+r.completed,0),1);
      const runs=await db.reportRun.findMany({where:{scheduleId:schedule.id}});assert.equal(runs.length,1);assert.equal(runs[0].status,"SUCCEEDED");
      const artifact=JSON.parse(decryptReportArtifact(runs[0].encryptedResult!,`${org.id}:${user.id}:${runs[0].id}`));assert.deepEqual(artifact.rows,[]);
      assert.equal(artifact.scope.facilityIds[0],facility.id);
      await db.reportRun.update({where:{id:runs[0].id},data:{expiresAt:new Date(now.getTime()-1)}});
      await runScheduledReports(now);assert.equal((await db.reportRun.findUniqueOrThrow({where:{id:runs[0].id}})).encryptedResult,null);
    });
    await t.test("revoked scheduled permission produces failed run without artifact",async()=>{
      await db.role.update({where:{id:role.id},data:{permissions:["reports.view"]}});
      await db.reportSchedule.update({where:{id:schedule.id},data:{nextRunAt:new Date(now.getTime()-1000)}});
      const result=await runScheduledReports(now);assert.equal(result.failed,1);
      const failed=await db.reportRun.findFirstOrThrow({where:{scheduleId:schedule.id,status:"FAILED"}});assert.equal(failed.encryptedResult,null);assert.equal(failed.failureCode,"FORBIDDEN");
    });
    await t.test("all native adapters execute real scoped PostgreSQL queries",async()=>{
      for(const dataset of visualReportDatasets.filter(d=>!d.importOnly)){
        const scope={organisationId:org.id,userId:user.id,unrestrictedFacilities:true,facilityIds:[]};
        const rows=await visualReportSource(scope,defaultVisualQuery(dataset.key,"2026-10-01",dataset.key==="unpaid-native"?"2026-10-01":"2026-10-31"));
        if(dataset.key==="audit"){assert.equal(rows.length,5);assert.ok(rows.every(row=>row.actor==="Synthetic employee"&&row.facility==="Reporting fixture store"));}else assert.deepEqual(rows,[],dataset.key);
      }
    });
    await t.test("native unpaid charges retain approved allocations, receipt quarantine and selected facility isolation",async()=>{
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic allocation"}});
      try {
        const account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID(),balance:100,currency:"ZAR"}});
        await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,status:"ACTIVE",startDate:new Date("2026-10-01")}});
        await db.ledgerEntry.create({data:{accountId:account.id,type:"CHARGE",amount:100,description:"Synthetic rent",effectiveAt:new Date("2026-10-01")}});
        await db.collectionCase.create({data:{accountId:account.id,terms:{dueDays:0,allocation:"OLDEST_DUE_FIRST",approvalReference:"Synthetic approval"}}});
        const scope={organisationId:org.id,userId:user.id,unrestrictedFacilities:true,facilityIds:[]};
        const query={...defaultVisualQuery("unpaid-native","2026-10-01","2026-10-01"),facilityId:facility.id};
        const rows=await visualReportSource(scope,query);assert.equal(rows.length,1);assert.equal(rows[0].amount,"100.00");assert.equal(rows[0].currency,"ZAR");assert.equal(rows[0].review,null);
        assert.deepEqual(await visualReportSource(scope,{...query,facilityId:other.id}),[]);
        await db.ledgerEntry.create({data:{accountId:account.id,type:"PAYMENT",amount:25,description:"Synthetic unverified receipt",effectiveAt:new Date("2026-10-01"),externalRef:randomUUID()}});
        await db.account.update({where:{id:account.id},data:{balance:75}});
        const quarantined=await visualReportSource(scope,query);assert.equal(quarantined[0].amount,null);assert.equal(quarantined[0].currency,null);assert.match(String(quarantined[0].review),/unverified receipt/);
        await assert.rejects(()=>visualReportSource(scope,{...query,groupBy:["currency"],metrics:[{field:"amount",operation:"sum"}]}),/REPORT_FINANCE_REVIEW_REQUIRED/);
      } finally {
        await db.ledgerEntry.deleteMany({where:{account:{customerId:customer.id}}});
        await db.collectionCase.deleteMany({where:{account:{customerId:customer.id}}});
        await db.tenancy.deleteMany({where:{customerId:customer.id}});
        await db.account.deleteMany({where:{customerId:customer.id}});
        await db.customer.delete({where:{id:customer.id}});
      }
    });
    await t.test("encrypted historical rows remain separate and cannot cross a facility scope",async()=>{
      const id=randomUUID(),rows=[{facility:"Reporting fixture store",unit:"Historical A1"}];
      await db.reportHistoryImport.create({data:{id,organisationId:org.id,facilityId:other.id,dataset:"units",name:"Synthetic history",extractedAt:new Date(),importedById:user.id,approvalReference:"CI validation only",sourceSha256:"synthetic",rowCount:1,encryptedRows:encryptReportArtifact(JSON.stringify(rows),`${org.id}:history:${id}`)}});
      const dataset=visualReportDatasets.find(d=>d.key==="units")!;
      const scope=visualReportScope(user.roleAssignments,dataset,user.id,org.id,facility.id);
      await assert.rejects(visualReportSource(scope,{...query,historyImportId:id}),/REPORT_NOT_FOUND/);
      await db.reportHistoryImport.update({where:{id},data:{facilityId:facility.id}});
      assert.deepEqual(await visualReportSource(scope,{...query,historyImportId:id}),rows);
      assert.equal(await db.unit.count({where:{facilityId:facility.id}}),0);
    });
  }finally{await db.organisation.delete({where:{id:org.id}});await db.$disconnect();}
});

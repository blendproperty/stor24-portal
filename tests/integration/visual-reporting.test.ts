import test from "node:test";
import type {Prisma} from "../../src/generated/prisma/client";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../../src/lib/db";
import {defaultVisualQuery} from "../../src/lib/visual-report-engine";
import {visualReportSchema,visualReportDatasets} from "../../src/lib/visual-report-contract";
import {saveVisualReport,scheduleVisualReport} from "../../src/lib/visual-report-service";
import {runScheduledReports} from "../../src/lib/visual-report-worker";
import {visualReportSource} from "../../src/lib/visual-report-data";
import {decryptReportArtifact,encryptReportArtifact,visualReportScope} from "../../src/lib/visual-report-security";
import {transfer} from "../../src/lib/leasing-service";
import {evaluateVisualReport} from "../../src/lib/visual-report-engine";
import {previewRentReview,approveRentReview} from "../../src/lib/rent-review-service";
import {addCustomerNote} from "../../src/lib/customer-history-service";

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
        const rows=await visualReportSource(scope,defaultVisualQuery(dataset.key,"2026-10-01",["unpaid-native","marketing-payment-cohorts"].includes(dataset.key)?"2026-10-01":"2026-10-31"));
        if(dataset.key==="audit"){assert.equal(rows.length,5);assert.ok(rows.every(row=>row.actor==="Synthetic employee"&&row.facility==="Reporting fixture store"));}else assert.deepEqual(rows,[],dataset.key);
      }
    });
    await t.test("native staff-note reporting reads actual retained producers without duplicating stores or changing source",async()=>{
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic notes customer"}});
      const scope={organisationId:org.id,userId:user.id,unrestrictedFacilities:true,facilityIds:[]};
      try{
        await db.lead.create({data:{facilityId:facility.id,customerId:customer.id,source:"Synthetic note fixture"}});
        await db.lead.create({data:{facilityId:other.id,customerId:customer.id,source:"Synthetic note fixture"}});
        const first=await addCustomerNote(scope,customer.id,{facilityId:facility.id,requestKey:randomUUID(),category:"HANDOVER",body:"Synthetic original handover"});
        const second=await addCustomerNote(scope,customer.id,{facilityId:other.id,requestKey:randomUUID(),category:"GENERAL",body:"Other store note"});
        await db.customerNote.update({where:{id:first.id},data:{createdAt:new Date("2026-09-30T22:00:00Z")}});
        await db.customerNote.update({where:{id:second.id},data:{createdAt:new Date("2026-10-01T08:00:00Z")}});
        const before=await db.customerNote.findMany({where:{customerId:customer.id},orderBy:{id:"asc"}}),auditCount=await db.auditEvent.count({where:{organisationId:org.id}});
        const q={...defaultVisualQuery("customer-notes-native","2026-10-01","2026-10-01"),dateField:"date"};
        const scoped={...scope,unrestrictedFacilities:false,facilityIds:[facility.id]},rows=await visualReportSource(scoped,q);
        assert.equal(rows.length,1);assert.equal(rows[0].noteId,first.id);assert.equal(rows[0].author,"Synthetic employee");assert.equal(rows[0].note,"Synthetic original handover");assert.equal(rows[0].customer,"Synthetic notes customer");
        assert.equal((await visualReportSource(scope,q)).length,2);
        assert.deepEqual(await visualReportSource(scoped,{...q,from:"2026-09-30",to:"2026-09-30"}),[]);
        await assert.rejects(visualReportSource(scoped,{...q,facilityId:other.id}),/FORBIDDEN/);
        await assert.rejects(visualReportSource(scoped,{...q,historyImportId:"unrecorded-history"}),/REPORT_NOTE_SOURCE/);
        assert.deepEqual(await db.customerNote.findMany({where:{customerId:customer.id},orderBy:{id:"asc"}}),before);
        assert.equal(await db.auditEvent.count({where:{organisationId:org.id}}),auditCount);
        await db.lead.deleteMany({where:{customerId:customer.id}});
        assert.deepEqual(await visualReportSource(scoped,q),[]);
        assert.equal((await visualReportSource(scope,q)).length,2);
      }finally{await db.lead.deleteMany({where:{customerId:customer.id}});await db.customer.delete({where:{id:customer.id}});}
    });
    await t.test("native transfer pairs use the actual producer and retain original links, scope, date basis and read-only baselines",async()=>{
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic transfer"}}),type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic transfer units"}});
      const foreignOrg=await db.organisation.create({data:{name:"Separate transfer-report fixture",slug:randomUUID()}}),foreignUser=await db.user.create({data:{organisationId:foreignOrg.id,name:"Separate reporting user",email:randomUUID()+"@example.invalid"}});
      const units=await Promise.all([0,1].map(i=>db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:`TRANSFER-${i}`,floor:"Ground Floor",monthlyRate:100,status:i===0?"OCCUPIED":"AVAILABLE"}})));
      let tenancyId:string|undefined;
      try{
        const account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID(),balance:0}}),tenancy=await db.tenancy.create({data:{customerId:customer.id,accountId:account.id,facilityId:facility.id,status:"ACTIVE",startDate:new Date("2026-01-01")}});tenancyId=tenancy.id;
        const from=await db.occupancy.create({data:{tenancyId:tenancy.id,unitId:units[0].id,status:"ACTIVE",startDate:new Date("2026-01-01"),monthlyRate:100}}),scope={organisationId:org.id,userId:user.id,unrestrictedFacilities:false,facilityIds:[facility.id]},effectiveAt=new Date("2026-10-01T22:30:00Z");
        const destination=await transfer(scope,{tenancyId:tenancy.id,toUnitId:units[1].id,effectiveAt});
        const audit=await db.auditEvent.findFirstOrThrow({where:{entityId:tenancy.id,action:"tenancy.transferred"}});await db.auditEvent.update({where:{id:audit.id},data:{occurredAt:new Date("2026-10-04T08:00:00Z")}});
        await db.unit.update({where:{id:units[0].id},data:{number:"RENAMED-CURRENT-UNIT"}});
        const baselineAccount=await db.account.findUniqueOrThrow({where:{id:account.id}}),baselineOccupancies=await db.occupancy.findMany({where:{tenancyId:tenancy.id},orderBy:{id:'asc'}}),baselineAudit=await db.auditEvent.findUniqueOrThrow({where:{id:audit.id}});
        const query=defaultVisualQuery("transfers-native","2026-10-01","2026-10-31"),rows=await visualReportSource(scope,query);assert.equal(rows.length,1);const row=rows[0];assert.equal(row.verified,true);assert.equal(row.fromUnitId,units[0].id);assert.equal(row.fromUnit,"RENAMED-CURRENT-UNIT");assert.equal(row.toUnitId,units[1].id);assert.equal(row.fromOccupancy,from.id);assert.equal(row.toOccupancy,destination.id);assert.equal(row.transfer,audit.id);assert.equal(row.account,account.accountNumber);
        assert.deepEqual(await visualReportSource({...scope,facilityIds:[other.id]},query),[]);assert.deepEqual(await visualReportSource({...scope,organisationId:foreignOrg.id,userId:foreignUser.id,unrestrictedFacilities:true,facilityIds:[]},query),[]);await assert.rejects(visualReportSource(scope,{...query,facilityId:other.id}),/FORBIDDEN/);
        const effectiveQuery={...query,from:"2026-10-02",to:"2026-10-02",dateField:"effective"};assert.equal(evaluateVisualReport(effectiveQuery,await visualReportSource(scope,effectiveQuery)).matchedRows,1);const recordedQuery={...effectiveQuery,dateField:'date'};assert.equal((await visualReportSource(scope,recordedQuery)).length,0);
        assert.deepEqual(await db.account.findUniqueOrThrow({where:{id:account.id}}),baselineAccount);assert.deepEqual(await db.occupancy.findMany({where:{tenancyId:tenancy.id},orderBy:{id:'asc'}}),baselineOccupancies);assert.deepEqual(await db.auditEvent.findUniqueOrThrow({where:{id:audit.id}}),baselineAudit);assert.equal(await db.payment.count({where:{accountId:account.id}}),0);assert.equal(await db.ledgerEntry.count({where:{accountId:account.id}}),0);assert.equal(await db.communicationLog.count({where:{organisationId:org.id}}),0);
        await db.auditEvent.update({where:{id:audit.id},data:{after:{unitId:units[1].id,occupancyId:destination.id}}});const held=await visualReportSource(scope,query);assert.equal(held[0].verified,false);assert.equal(held[0].review,'TRANSFER_PAYLOAD_REVIEW');await assert.rejects(visualReportSource(scope,effectiveQuery),/REPORT_TRANSFER_DATE_REVIEW/);
      }finally{
        if(tenancyId){await db.auditEvent.deleteMany({where:{entityId:tenancyId,action:'tenancy.transferred'}});await db.occupancy.deleteMany({where:{tenancyId}});await db.tenancy.delete({where:{id:tenancyId}})}
        await db.account.deleteMany({where:{customerId:customer.id}});await db.customer.delete({where:{id:customer.id}});await db.unit.deleteMany({where:{unitTypeId:type.id}});await db.unitType.delete({where:{id:type.id}});
        await db.organisation.delete({where:{id:foreignOrg.id}});
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
    await t.test("native approved rent history uses the actual approval producer, retains immutable rates and holds broken sources",async()=>{
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"Synthetic rent approval"}}),type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic rate history"}});
      const unit=await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"RENT-HISTORY-CI",floor:"Ground Floor",monthlyRate:100,status:"OCCUPIED"}});
      const account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID(),balance:0,currency:"ZAR"}}),tenancy=await db.tenancy.create({data:{customerId:customer.id,accountId:account.id,facilityId:facility.id,status:"ACTIVE",startDate:new Date("2026-01-01")}});
      const occupancy=await db.occupancy.create({data:{tenancyId:tenancy.id,unitId:unit.id,status:"ACTIVE",startDate:new Date("2026-01-01"),monthlyRate:100}});
      let auditId:string|undefined;
      try{
        const now=new Date(),effectivePeriod=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+2,1)).toISOString().slice(0,7),input={selectedOccupancyIds:[occupancy.id],facilityId:facility.id,minimumMonths:0,basis:"TIME_IN_UNIT",type:"AMOUNT",value:12.34,effectivePeriod};
        const preview=await previewRentReview(org.id,input);await approveRentReview(org.id,user.id,input,preview.fingerprint,"Synthetic rate history approval");
        const audit=await db.auditEvent.findFirstOrThrow({where:{organisationId:org.id,action:"rent.group_increase.approved",entityId:facility.id},orderBy:{occurredAt:"desc"}});auditId=audit.id;
        await db.auditEvent.update({where:{id:audit.id},data:{occurredAt:new Date("2026-10-04T22:30:00Z")}});await db.unit.update({where:{id:unit.id},data:{number:"CURRENT-RENAMED-RENT-UNIT"}});
        const scope={organisationId:org.id,userId:user.id,unrestrictedFacilities:false,facilityIds:[facility.id]},query=defaultVisualQuery("approved-rent-history-native","2026-10-01","2026-10-31");
        const baseline={account:await db.account.findUniqueOrThrow({where:{id:account.id}}),occupancy:await db.occupancy.findUniqueOrThrow({where:{id:occupancy.id}}),audit:await db.auditEvent.findUniqueOrThrow({where:{id:audit.id}}),schedule:await db.configurationProfile.findMany({where:{organisationId:org.id,domain:"OCCUPANCY_RENT_SCHEDULE",name:occupancy.id}})};
        const rows=await visualReportSource(scope,query);assert.equal(rows.length,1);assert.equal(rows[0].verified,true);assert.equal(rows[0].previousRate,"100.00");assert.equal(rows[0].newRate,"112.34");assert.equal(rows[0].changeAmount,"12.34");assert.equal(rows[0].unit,"CURRENT-RENAMED-RENT-UNIT");assert.equal(rows[0].date,"2026-10-05");assert.equal(rows[0].effective,effectivePeriod+"-01");
        const effectiveQuery={...query,dateField:"effective",from:effectivePeriod+"-01",to:effectivePeriod+"-01"};assert.equal(evaluateVisualReport(effectiveQuery,await visualReportSource(scope,effectiveQuery)).matchedRows,1);assert.equal(evaluateVisualReport({...effectiveQuery,dateField:"date"},rows).matchedRows,0);
        assert.deepEqual(await visualReportSource({...scope,facilityIds:[other.id]},query),[]);assert.deepEqual(await visualReportSource({...scope,organisationId:"separate-organisation",unrestrictedFacilities:true,facilityIds:[]},query),[]);await assert.rejects(visualReportSource(scope,{...query,facilityId:other.id}),/FORBIDDEN/);await assert.rejects(visualReportSource(scope,{...query,historyImportId:randomUUID()}),/REPORT_RATE_HISTORY_SOURCE/);
        assert.deepEqual({account:await db.account.findUniqueOrThrow({where:{id:account.id}}),occupancy:await db.occupancy.findUniqueOrThrow({where:{id:occupancy.id}}),audit:await db.auditEvent.findUniqueOrThrow({where:{id:audit.id}}),schedule:await db.configurationProfile.findMany({where:{organisationId:org.id,domain:"OCCUPANCY_RENT_SCHEDULE",name:occupancy.id}})},baseline);assert.equal(await db.payment.count({where:{accountId:account.id}}),0);assert.equal(await db.ledgerEntry.count({where:{accountId:account.id}}),0);
        await db.auditEvent.update({where:{id:audit.id},data:{after:{...audit.after as object,changes:[{occupancyId:"missing-original-occupancy",before:100,after:112.34}]}}});const held=await visualReportSource(scope,query);assert.equal(held[0].reviewCode,"RATE_APPROVAL_REFERENCE_REVIEW");assert.equal(held[0].newRate,null);assert.equal(held[0].currency,null);await assert.rejects(visualReportSource(scope,{...query,groupBy:["currency"],metrics:[{field:"newRate",operation:"sum"}]}),/REPORT_RATE_REVIEW_REQUIRED/);
        const foreignOrg=await db.organisation.create({data:{name:"Separate rent-history source",slug:randomUUID()}});
        try{const foreignFacility=await db.facility.create({data:{organisationId:foreignOrg.id,name:"PRIVATE-FOREIGN-RENT-STORE",code:randomUUID()}});await db.auditEvent.update({where:{id:audit.id},data:{facilityId:foreignFacility.id,entityId:foreignFacility.id,after:audit.after as Prisma.InputJsonValue}});const foreign=await visualReportSource({...scope,unrestrictedFacilities:true,facilityIds:[]},query);assert.equal(foreign[0].reviewCode,"RATE_APPROVAL_REFERENCE_REVIEW");assert.equal(foreign[0].facility,"Unassigned");assert.ok(!JSON.stringify(foreign).includes("PRIVATE-FOREIGN-RENT-STORE"));}finally{await db.auditEvent.update({where:{id:audit.id},data:{facilityId:facility.id,entityId:facility.id}});await db.organisation.delete({where:{id:foreignOrg.id}});}
        await db.auditEvent.update({where:{id:audit.id},data:{after:{}}});assert.equal((await visualReportSource(scope,query))[0].reviewCode,"RATE_APPROVAL_PAYLOAD_REVIEW");await assert.rejects(visualReportSource(scope,effectiveQuery),/REPORT_RATE_DATE_REVIEW/);
      }finally{
        if(auditId)await db.auditEvent.delete({where:{id:auditId}});await db.configurationProfile.deleteMany({where:{organisationId:org.id,domain:"OCCUPANCY_RENT_SCHEDULE",name:occupancy.id}});await db.occupancy.delete({where:{id:occupancy.id}});await db.tenancy.delete({where:{id:tenancy.id}});await db.account.delete({where:{id:account.id}});await db.customer.delete({where:{id:customer.id}});await db.unit.delete({where:{id:unit.id}});await db.unitType.delete({where:{id:type.id}});
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

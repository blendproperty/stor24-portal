import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { db } from "../../src/lib/db";
import { addCustomerNote, customerHistory } from "../../src/lib/customer-history-service";
import { compareHistoryEntries, type HistoryEntry } from "../../src/lib/customer-history-policy";
import type { RequestScope } from "../../src/lib/scope";
import { buildCustomerHistoryExport } from "../../src/lib/customer-history-export";

test("isolated PostgreSQL shared customer notebook and scoped history", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const key = randomUUID();
  const org = await db.organisation.create({ data: { name: "Synthetic history", slug: key } });
  const other = await db.organisation.create({ data: { name: "Other synthetic org", slug: randomUUID() } });
  const a = await db.facility.create({ data: { organisationId: org.id, code: "A", name: "Midpoint fixture" } });
  const b = await db.facility.create({ data: { organisationId: org.id, code: "B", name: "Other store fixture" } });
  const staff = await db.user.create({ data: { organisationId: org.id, name: "Faeez fixture", email: `staff-${key}@example.invalid` } });
  const cover = await db.user.create({ data: { organisationId: org.id, name: "Covering staff fixture", email: `cover-${key}@example.invalid` } });
  const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic", notes: "Original undated summary" } });
  await db.lead.createMany({ data: [a, b].map(f => ({ facilityId: f.id, customerId: customer.id, source: "OTHER" })) });
  const account = await db.account.create({ data: { customerId: customer.id, accountNumber: key } });
  await db.tenancy.create({ data: { customerId: customer.id, facilityId: a.id, accountId: account.id, startDate: new Date() } });
  const collection = await db.collectionCase.create({ data: { accountId: account.id } });
  const scope: RequestScope = { userId: staff.id, organisationId: org.id, facilityIds: [a.id], unrestrictedFacilities: false };
  const coverScope = { ...scope, userId: cover.id };
  const grants = (s: RequestScope) => ({ communications: s, collections: s, write: s });
  const query = { kind: "ALL" as const, search: "" };
  const note = () => ({ facilityId: a.id, requestKey: randomUUID(), category: "HANDOVER" as const, body: "Customer asked for a call tomorrow. Covering staff to follow up." });
  try {
    await t.test("shared author-dated append-only notes and atomic same-key retries", async () => {
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_customer_note_audit_failure CHECK (action <> 'customer.note_added') NOT VALID`);
      try {
        await assert.rejects(addCustomerNote(scope, customer.id, note()));
        assert.equal(await db.customerNote.count({ where: { customerId: customer.id } }), 0);
      } finally { await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_customer_note_audit_failure'); }
      const command = note();
      const results = await Promise.all([addCustomerNote(scope, customer.id, command), addCustomerNote(scope, customer.id, command)]);
      assert.equal(results[0].id, results[1].id);
      assert.equal(await db.customerNote.count({ where: { customerId: customer.id } }), 1);
      assert.equal(await db.auditEvent.count({ where: { action: "customer.note_added", entityId: results[0].id } }), 1);
      await assert.rejects(addCustomerNote(scope, customer.id, { ...command, body: "Changed payload" }), /CONFLICT/);
      await assert.rejects(addCustomerNote(coverScope, customer.id, command), /CONFLICT/);
      await db.user.update({ where: { id: staff.id }, data: { name: "Renamed staff" } });
      const history = await customerHistory(coverScope, customer.id, query, grants(coverScope));
      assert.equal(history.entries[0].author, "Faeez fixture");
      assert.equal(history.entries[0].category, "HANDOVER");
      assert.equal(history.legacyNotes, "Original undated summary");
      assert.ok(history.entries[0].at);
      await addCustomerNote(coverScope, customer.id, { ...note(), category: "CALL", body: "Cover completed the customer call." });
      assert.equal((await customerHistory(scope, customer.id, query, grants(scope))).entries.length, 2);
    });
    await t.test("customer/store/organisation boundaries and separate source permissions", async () => {
      await assert.rejects(addCustomerNote(scope, customer.id, { ...note(), facilityId: b.id }), /FORBIDDEN/);
      const bScope = { ...scope, facilityIds: [b.id] };
      await addCustomerNote(bScope, customer.id, { ...note(), facilityId: b.id, body: "Other store private note" });
      await db.communicationLog.createMany({ data: [
        { organisationId: org.id, customerId: customer.id, facilityId: a.id, channel: "EMAIL", recipientHash: "synthetic", idempotencyKey: randomUUID(), messageType: "BOOKING_CONFIRMED", status: "PENDING", metadata: { password: "DO-NOT-RETURN", secureUrl: "DO-NOT-RETURN" } },
        { organisationId: org.id, customerId: customer.id, facilityId: b.id, channel: "SMS", recipientHash: "synthetic", idempotencyKey: randomUUID(), messageType: "OTHER_STORE_PRIVATE" },
        { organisationId: org.id, customerId: customer.id, facilityId: null, channel: "WHATSAPP", recipientHash: "synthetic", idempotencyKey: randomUUID(), messageType: "HISTORICAL_UNASSIGNED" },
      ] });
      await db.collectionActivity.create({ data: { caseId: collection.id, actorId: staff.id, requestKey: randomUUID(), action: "follow-up", note: "Collection call evidence", payload: { secret: "DO-NOT-RETURN" } } });
      const history = await customerHistory(scope, customer.id, query, grants(scope));
      assert.ok(!JSON.stringify(history).includes("Other store private"));
      assert.ok(!JSON.stringify(history).includes("OTHER_STORE_PRIVATE"));
      assert.ok(!JSON.stringify(history).includes("DO-NOT-RETURN"));
      assert.ok(history.entries.some(e => e.kind === "COLLECTION"));
      assert.equal(history.entries.filter(e => e.kind === "COMMUNICATION").length, 2);
      assert.equal(history.entries.find(e => e.title.includes("BOOKING"))?.deliveredAt, null);
      const limited = await customerHistory(scope, customer.id, query, { communications: null, collections: null, write: null });
      assert.ok(limited.entries.every(e => e.kind === "NOTE"));
      assert.deepEqual(limited.visibility, { communications: false, collections: false });
      assert.equal(limited.writableFacilities.length, 0);
      const split = await customerHistory(scope, customer.id, query, { communications: bScope, collections: bScope, write: bScope });
      assert.ok(split.entries.every(e => e.kind === "NOTE"));
      assert.equal(split.writableFacilities.length, 0);
      await assert.rejects(customerHistory({ ...scope, organisationId: other.id, unrestrictedFacilities: true }, customer.id, query, grants(scope)), /FORBIDDEN/);
      await assert.rejects(customerHistory({ ...scope, facilityIds: [] }, customer.id, query, grants(scope)), /FORBIDDEN/);
    });
    await t.test("complete stable paging through mixed events and timestamp ties", async () => {
      const at = new Date("2026-01-15T10:00:00Z");
      await db.customerNote.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ organisationId: org.id, customerId: customer.id, facilityId: a.id, authorId: staff.id, authorName: "Synthetic staff", category: "GENERAL", body: `Historical note ${i}`, requestKey: randomUUID(), createdAt: at })) });
      await db.collectionActivity.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ caseId: collection.id, actorId: staff.id, requestKey: randomUUID(), action: "contact", note: `Old call ${i}`, payload: {}, createdAt: at })) });
      await db.communicationLog.createMany({ data: Array.from({ length: 25 }, () => ({ organisationId: org.id, customerId: customer.id, facilityId: a.id, channel: "EMAIL", recipientHash: "synthetic", idempotencyKey: randomUUID(), messageType: "RENT_REMINDER", queuedAt: at })) });
      const first = await customerHistory(scope, customer.id, query, grants(scope));
      const found: HistoryEntry[] = [...first.entries];
      await db.customerNote.create({ data: { organisationId: org.id, customerId: customer.id, facilityId: a.id, authorId: staff.id, authorName: "New staff", category: "GENERAL", body: "New after snapshot", requestKey: randomUUID(), createdAt: new Date(Date.now() + 1000) } });
      let cursor = first.nextCursor, pages = 1;
      while (cursor) { assert.ok(pages++ < 10); const page = await customerHistory(scope, customer.id, { ...query, cursor }, grants(scope)); found.push(...page.entries); cursor = page.nextCursor; }
      assert.equal(found.length, 115);
      assert.equal(new Set(found.map(e => e.kind + e.id)).size, 115);
      assert.deepEqual(found, [...found].sort(compareHistoryEntries));
      const fullExport=await buildCustomerHistoryExport(scope,customer.id,query,grants(scope));
      assert.ok(fullExport.rows.filter(row=>row.kind!=="LEGACY_SUMMARY").length>=115);
      assert.ok(found.every(entry=>fullExport.rows.some(row=>row.recordId===entry.id)));
      assert.ok(fullExport.rows.some(row=>row.kind==="LEGACY_SUMMARY"));
      assert.ok(!JSON.stringify(fullExport.rows).includes("Other store private"));
      assert.ok(!JSON.stringify(fullExport.rows).includes("DO-NOT-RETURN"));
      const single=await buildCustomerHistoryExport(scope,customer.id,query,grants(scope),{id:found[0].id,kind:found[0].kind});
      assert.equal(single.rows.length,1);
      await assert.rejects(buildCustomerHistoryExport(scope,customer.id,query,grants(scope),{id:"foreign-record",kind:"NOTE"}),/NOT_FOUND/);
      assert.ok(!found.some(e => e.body === "New after snapshot"));
      const filtered = await customerHistory(scope, customer.id, { kind: "ALL", category: "CALL", search: "completed" }, grants(scope));
      assert.equal(filtered.entries.length, 1);
      assert.equal(filtered.entries[0].category, "CALL");
      const messages = await customerHistory(scope, customer.id, { kind: "COMMUNICATION", search: "RENT" }, grants(scope));
      assert.equal(messages.entries.length, 25);
      assert.ok(messages.entries.every(e => e.title.includes("RENT")));
      await assert.rejects(customerHistory(scope, customer.id, { ...query, cursor: "invalid" }, grants(scope)), /HISTORY_CURSOR_INVALID/);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: account.id } })).balance.toString(), "0");
      assert.equal(await db.payment.count({ where: { accountId: account.id } }), 0);
      assert.equal(await db.collectionPromise.count({ where: { caseId: collection.id } }), 0);
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: org.id } }), 0);
    });
    await t.test("actual download endpoint releases complete audited files only with current exact store grants", async () => {
      const permissions=["operations.view","communications.view","collections.view"];
      const role=await db.role.create({data:{organisationId:org.id,name:"Scoped history downloads",permissions}});
      await db.roleAssignment.create({data:{userId:staff.id,roleId:role.id,facilityId:a.id}});
      const output=await build({entryPoints:["src/app/api/v1/customers/[customerId]/history/export/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"real-history-api",setup(builder){
        builder.onResolve({filter:/^@\/lib\/(db|session)$/},args=>({path:args.path,namespace:"fixture"}));
        builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path.endsWith("/db")?"export const db=__db;":"export const getSession=async()=>__session;"}));
      }}]});
      const loaded={exports:{} as {POST:(r:Request,c:unknown)=>Promise<Response>}};
      new Function("require","module","exports","__db","__session",output.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,db,{userId:staff.id,sessionVersion:staff.sessionVersion});
      const download=(body:unknown={format:"CSV"},id=customer.id,origin="https://example.invalid")=>loaded.exports.POST(new Request("https://example.invalid/api/v1/customers/one/history/export",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({customerId:id})});
      assert.equal((await download()).status,403);
      await db.role.update({where:{id:role.id},data:{permissions:[...permissions,"customer_history.export"]}});
      assert.equal((await download({format:"XLSX"},customer.id,"https://attacker.invalid")).status,403);
      const foreignCustomer=await db.customer.create({data:{organisationId:other.id,firstName:"Foreign"}});
      const otherStore=await db.customer.create({data:{organisationId:org.id,firstName:"Other store",leads:{create:{facilityId:b.id,source:"CI"}}}});
      assert.equal((await download({format:"XLSX"},foreignCustomer.id)).status,403);
      assert.equal((await download({format:"XLSX"},otherStore.id)).status,403);
      const response=await download();assert.equal(response.status,200);
      assert.match(response.headers.get("cache-control")!,/no-store/);
      const bytes=new Uint8Array(await response.arrayBuffer());const csv=new TextDecoder().decode(bytes);
      for(let i=0;i<60;i++)assert.ok(csv.includes(`Historical note ${i}`));
      assert.ok(!csv.includes("Other store private"));assert.ok(!csv.includes("DO-NOT-RETURN"));
      const audit=await db.auditEvent.findFirstOrThrow({where:{entityId:customer.id,action:"customer.history_downloaded"},orderBy:{occurredAt:"desc"}});
      assert.equal((audit.after as {sha256:string}).sha256,createHash("sha256").update(bytes).digest("hex"));
      const pdf=await download({format:"PDF",kind:"NOTE"});assert.equal(pdf.status,200);assert.ok((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount()>1);
      const excel=await download({format:"XLSX"});assert.equal(excel.status,200);
      assert.match(excel.headers.get("content-type")!,/spreadsheetml.sheet/);assert.match(excel.headers.get("content-disposition")!,/\.xlsx/);assert.match(excel.headers.get("cache-control")!,/no-store/);
      const excelBytes=await excel.arrayBuffer(),book=new ExcelJS.Workbook();await book.xlsx.load(excelBytes);
      const cells=JSON.stringify(book.worksheets[0].getSheetValues());
      for(let i=0;i<60;i++)assert.ok(cells.includes(`Historical note ${i}`));
      assert.ok(!cells.includes("Other store private"));assert.ok(!cells.includes("DO-NOT-RETURN"));
      const excelAudit=await db.auditEvent.findFirstOrThrow({where:{entityId:customer.id,action:"customer.history_downloaded"},orderBy:{occurredAt:"desc"}});
      assert.equal((excelAudit.after as {format:string}).format,"XLSX");assert.equal((excelAudit.after as {sha256:string}).sha256,createHash("sha256").update(new Uint8Array(excelBytes)).digest("hex"));
      const filteredExcel=await download({format:"XLSX",kind:"NOTE",category:"CALL",search:"completed"});assert.equal(filteredExcel.status,200);
      const filteredBook=new ExcelJS.Workbook();await filteredBook.xlsx.load(await filteredExcel.arrayBuffer());assert.equal(filteredBook.worksheets[0].rowCount,6);assert.equal(filteredBook.worksheets[0].getCell("E6").value,"CALL");
      const selected=await db.customerNote.findFirstOrThrow({where:{customerId:customer.id,facilityId:a.id}});
      assert.equal((await download({format:"CSV",entryId:selected.id,entryKind:"NOTE"})).status,200);
      await db.communicationLog.createMany({data:Array.from({length:51},()=>({organisationId:org.id,customerId:customer.id,facilityId:a.id,channel:"SMS" as const,provider:"twilio",providerRef:"SM"+"d".repeat(32),recipientHash:"synthetic",idempotencyKey:randomUUID(),messageType:"ARCHIVED_NOTICE",metadata:{historyEvidence:{version:1,text:"Archived safe notice",subject:"Notice",redacted:true}}}))});
      const retained=await download({format:"CSV",kind:"COMMUNICATION",search:"ARCHIVED_NOTICE"});assert.equal(retained.status,200);assert.equal(((await retained.text()).match(/Archived safe notice/g)??[]).length,51);
      const excluded=await db.customerNote.findFirstOrThrow({where:{customerId:customer.id,facilityId:b.id}});
      assert.equal((await download({format:"CSV",entryId:excluded.id,entryKind:"NOTE"})).status,404);
      const saveAudit=db.auditEvent.create.bind(db.auditEvent);
      db.auditEvent.create=(async args=>{if(args.data.action==="dlp.export.allowed")await db.role.update({where:{id:role.id},data:{permissions}});return saveAudit(args);}) as typeof db.auditEvent.create;
      try{assert.equal((await download({format:"XLSX"})).status,403);}finally{db.auditEvent.create=saveAudit;await db.role.update({where:{id:role.id},data:{permissions:[...permissions,"customer_history.export"]}});}
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_history_download_audit_failure CHECK (action <> 'customer.history_downloaded') NOT VALID`);
      try{assert.equal((await download({format:"XLSX"})).status,500);}finally{await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_history_download_audit_failure');}
      const credential=await db.customerNote.create({data:{organisationId:org.id,customerId:customer.id,facilityId:a.id,authorId:staff.id,authorName:"Synthetic",category:"GENERAL",body:"Bearer "+"synthetic".repeat(6),requestKey:randomUUID()}});
      assert.equal((await download({format:"XLSX",entryId:credential.id,entryKind:"NOTE"})).status,422);
      await db.role.update({where:{id:role.id},data:{permissions}});
      assert.equal((await download()).status,403);
      await db.roleAssignment.deleteMany({where:{userId:staff.id}});
    });
    await t.test("new unlinked customers stay creator-only; approved reset deletion retains its existing behaviour", async () => {
      const unlinked = await db.customer.create({ data: { organisationId: org.id, firstName: "Unlinked" } });
      await db.auditEvent.create({ data: { organisationId: org.id, actorId: staff.id, entityType: "Customer", entityId: unlinked.id, action: "customer.created" } });
      await addCustomerNote(scope, unlinked.id, note());
      await assert.rejects(customerHistory(coverScope, unlinked.id, query, grants(coverScope)), /FORBIDDEN/);
      await db.customer.delete({ where: { id: unlinked.id } });
      assert.equal(await db.customerNote.count({ where: { customerId: unlinked.id } }), 0);
    });
  } finally { await db.$disconnect(); }
});

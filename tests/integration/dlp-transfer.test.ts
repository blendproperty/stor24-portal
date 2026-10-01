import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { guardDlpTransfer, protectDlpResponse } from "../../src/lib/dlp-transfer-service";

test("isolated PostgreSQL persists DLP decisions, bounds concurrent split downloads and fails closed on audit rejection", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");
  const target=new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname,"localhost");assert.equal(target.pathname,"/merchandise_ci");
  process.env.AUTH_SECRET = "synthetic-isolated-ci-dlp-key-32-characters";
  const nonce=randomUUID(), org=await db.organisation.create({data:{name:"Synthetic DLP CI",slug:nonce}});
  const actor=await db.user.create({data:{organisationId:org.id,name:"Synthetic DLP CI",email:`${nonce}@example.invalid`}});
  let auditConstraint=false;
  try {
    const input={organisationId:org.id,actorId:actor.id,resourceId:"synthetic-document",channel:"DOWNLOAD" as const,classification:"restricted" as const,byteLength:10};
    const burst=await Promise.allSettled(Array.from({length:80},()=>guardDlpTransfer(input)));
    assert.equal(burst.filter(result=>result.status==="fulfilled").length,60);
    assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:"dlp.transfer.allowed"}}),60);
    assert.equal(await db.auditEvent.count({where:{organisationId:org.id,action:"dlp.transfer.blocked"}}),20);
    const mail={organisationId:org.id,resourceId:"synthetic-mail",channel:"EMAIL" as const,classification:"confidential" as const,recipient:"recipient@example.invalid",approvedRecipient:"recipient@example.invalid",content:"4111 1111 1111 1111"};
    await assert.rejects(guardDlpTransfer(mail),/DLP_TRANSFER_BLOCKED/);
    const events=await db.auditEvent.findMany({where:{organisationId:org.id}});
    assert.doesNotMatch(JSON.stringify(events),/4111 1111|recipient@example/);
    assert.ok(events.every(event=>event.requestId));
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" ADD CONSTRAINT ci_dlp_audit_failure CHECK (false) NOT VALID');auditConstraint=true;
    await assert.rejects(protectDlpResponse(new Response(new Uint8Array([37,80,68,70])),{organisationId:org.id,resourceId:"audit-outage-document"}));
    await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_dlp_audit_failure');auditConstraint=false;
    const response=await protectDlpResponse(new Response(new Uint8Array([37,80,68,70])),{organisationId:org.id,resourceId:"restored-audit-document"});
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([37,80,68,70]));
  } finally {
    if(auditConstraint)await db.$executeRawUnsafe('ALTER TABLE "AuditEvent" DROP CONSTRAINT ci_dlp_audit_failure');
    await db.auditEvent.deleteMany({where:{organisationId:org.id}});
    await db.rateLimitBucket.deleteMany({where:{key:{startsWith:`dlp:${org.id}:`}}});
    await db.organisation.delete({where:{id:org.id}});await db.$disconnect();
  }
});

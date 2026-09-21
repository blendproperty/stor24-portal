import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { checkMriConnection, mriConfiguration, mriSourceReview, saveMriConfiguration } from "../../src/lib/mri-service";
import { decryptIntegrationSecret } from "../../src/lib/integrations/integration-secret-vault";

test("isolated MRI preparation: secrets, scope, concurrency and read-only source review", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "mri-isolated-fixture-key-only-at-least-32-characters";
  const fixture = async () => {
    const key = randomUUID(), org = await db.organisation.create({ data: { name: "MRI CI", slug: key } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "MRI CI", email: key + "@example.invalid" } });
    return { organisationId: org.id, userId: user.id, unrestrictedFacilities: true, facilityIds: [] };
  };
  const input = { revision: null, databaseLabel: "CI Blend", environment: "unknown", login: "ci-login", password: "ci-password-only", databaseIdentifier: "ci-database-only" };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected provider network call"); };
  try {
    await t.test("connection proof is scoped, revision-bound, redacted and reset after edits", async () => {
      const scope = await fixture(), saved = await saveMriConfiguration(scope, { ...input, databaseIdentifier: "" });
      const fake: typeof fetch = async url => String(url).endsWith("/Token") ? Response.json({access_token:"ci-never-save-this-token",token_type:"bearer"}) : String(url).endsWith("GetDatabaseAccessList") ? Response.json([{DatabaseName:"CI Blend",DatabaseIdentifier:"ci-discovered-identifier"}]) : Response.json({ResultCount:2,ResultSet:[{Id:1}]});
      const check = await checkMriConnection(scope, saved.revision!, fake);
      assert.equal(check.authenticated,true); assert.equal(check.databaseReadable,false); assert.equal(check.databases.length,1);
      assert.ok(!JSON.stringify(check).includes("ci-discovered-identifier"));
      const picked = await saveMriConfiguration(scope,{revision:check.revision,databaseLabel:"ignored user label",environment:"unknown",databaseKey:check.databases[0].key});
      assert.equal(picked.databaseLabel,"CI Blend"); assert.equal(picked.authenticated,false); assert.equal(picked.databaseIdentifierStored,true);
      const verified = await checkMriConnection(scope,picked.revision!,fake);
      assert.equal(verified.databaseReadable,true); assert.equal(verified.postingEnabled,false);
      const row=await db.integrationConnection.findUniqueOrThrow({where:{id:`mri:${scope.organisationId}`}});
      const audits=await db.auditEvent.findMany({where:{organisationId:scope.organisationId}});
      assert.ok(!JSON.stringify([row,audits]).includes("ci-never-save-this-token"));
      await assert.rejects(checkMriConnection({...scope,unrestrictedFacilities:false},verified.revision!,fake),/MRI_ORG_PERMISSION/);
      await assert.rejects(checkMriConnection(scope,picked.revision!,fake),/MRI_CHANGED/);
      let altered=false;
      await assert.rejects(checkMriConnection(scope,verified.revision!,async (...args)=>{
        if(!altered){altered=true;await saveMriConfiguration(scope,{...input,revision:verified.revision,databaseLabel:"CI changed mid-check"});}
        return fake(...args);
      }),/MRI_CHANGED/);
      assert.equal((await mriConfiguration(scope)).authenticated,false);
    });
    await t.test("provider failure does not retain stale successful connection evidence", async () => {
      const scope=await fixture(),saved=await saveMriConfiguration(scope,input);
      const failed=await checkMriConnection(scope,saved.revision!,async()=>new Response("sensitive-provider-error",{status:401}));
      assert.equal(failed.authenticated,false);assert.equal(failed.databaseReadable,false);assert.equal(failed.failureCode,"MRI_AUTH_REJECTED");
      assert.ok(!JSON.stringify(failed).includes("sensitive-provider-error"));
    });
    await t.test("encrypted secrets, safe readback and audit; saving never enables posting", async () => {
      const scope = await fixture(), result = await saveMriConfiguration(scope, input);
      assert.equal(result.credentialsStored, true); assert.equal(result.authenticated, false); assert.equal(result.postingEnabled, false);
      assert.ok(!JSON.stringify(result).includes(input.password));
      const saved = await db.integrationConnection.findUniqueOrThrow({ where: { id: `mri:${scope.organisationId}` } });
      const config = saved.config as Record<string, string>;
      for (const secret of [input.password, input.login, input.databaseIdentifier]) assert.ok(!JSON.stringify(saved).includes(secret));
      assert.equal(decryptIntegrationSecret(config.passwordEncrypted), input.password);
      const audits = await db.auditEvent.findMany({ where: { organisationId: scope.organisationId } });
      assert.equal(audits.length, 1); assert.ok(!JSON.stringify(audits).includes(input.password));
      assert.ok(!JSON.stringify(audits).includes(input.databaseIdentifier));
      const retained = await saveMriConfiguration(scope, { revision: result.revision, databaseLabel: input.databaseLabel, environment: "unknown" });
      assert.equal(retained.databaseIdentifierStored, true);
      const changed = await saveMriConfiguration(scope, { revision: retained.revision, databaseLabel: "CI Other", environment: "live" });
      assert.equal(changed.databaseIdentifierStored, false); assert.equal(changed.postingEnabled, false);
    });
    await t.test("organisation isolation and facility-only denial", async () => {
      const a = await fixture(), b = await fixture(); await saveMriConfiguration(a, input);
      assert.equal((await mriConfiguration(b)).credentialsStored, false);
      const restricted = { ...a, unrestrictedFacilities: false };
      await assert.rejects(mriConfiguration(restricted), /MRI_ORG_PERMISSION/);
      await assert.rejects(saveMriConfiguration(restricted, input), /MRI_ORG_PERMISSION/);
      await assert.rejects(mriSourceReview(restricted, "2026-01"), /MRI_ORG_PERMISSION/);
    });
    await t.test("simultaneous initial saves and edits cannot overwrite each other", async () => {
      const scope = await fixture();
      const initial = await Promise.allSettled([saveMriConfiguration(scope, input), saveMriConfiguration(scope, { ...input, databaseLabel: "CI simultaneous" })]);
      assert.equal(initial.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(await db.integrationConnection.count({ where: { organisationId: scope.organisationId } }), 1);
      const loaded = await mriConfiguration(scope);
      const edits = await Promise.allSettled([saveMriConfiguration(scope, { ...input, revision: loaded.revision }), saveMriConfiguration(scope, { ...input, revision: loaded.revision, databaseLabel: "CI competing" })]);
      assert.equal(edits.filter(r => r.status === "fulfilled").length, 1);
      await assert.rejects(saveMriConfiguration(scope, input), /MRI_CHANGED/);
      assert.equal(await db.auditEvent.count({ where: { organisationId: scope.organisationId } }), 2);
    });
    await t.test("source review excludes test history, enforces month and org, and performs no writes", async () => {
      const scope = await fixture(), other = await fixture();
      const customer = await db.customer.create({ data: { organisationId: scope.organisationId, firstName: "Private CI name" } });
      const account = await db.account.create({ data: { customerId: customer.id, accountNumber: randomUUID() } });
      const entry = await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 115, taxAmount: 15, description: "Private CI description", effectiveAt: new Date("2025-12-31T22:00:00Z") } });
      const review = await mriSourceReview(scope, "2026-01");
      assert.equal(review.rowCount, 1); assert.equal(review.groups[0].amount, "115.00");
      assert.equal((await mriSourceReview(scope, "2025-12")).rowCount, 0);
      assert.equal((await mriSourceReview(other, "2026-01")).rowCount, 0);
      assert.ok(!JSON.stringify(review).includes("Private CI"));
      await db.payment.create({ data: { accountId: account.id, amount: 1, method: "CI", status: "TEST_SUCCEEDED", environment: "sandbox", idempotencyKey: randomUUID() } });
      const excluded = await mriSourceReview(scope, "2026-01");
      assert.equal(excluded.excluded, 1); assert.equal(excluded.groups.length, 0); assert.notEqual(excluded.fingerprint, review.fingerprint);
      assert.equal(await db.auditEvent.count({ where: { organisationId: scope.organisationId } }), 0);
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: scope.organisationId } }), 0);
      assert.equal((await db.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).amount.toFixed(2), "115.00");
    });
  } finally { globalThis.fetch = nativeFetch; await db.$disconnect(); }
});

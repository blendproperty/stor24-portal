import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/lib/db";
import { checkMriConnection, mriConfiguration, mriSandboxWorkspace, saveMriConfiguration, prepareStoredMriSandbox } from "../../src/lib/mri-service";

test("isolated MRI sandbox targets, preserved primary settings and real-adapter checks", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY = "mri-sandbox-ci-encryption-key-at-least-32-chars";
  const fake: typeof fetch = async url => String(url).endsWith("/Token") ? Response.json({ access_token: "ci-access-token-only", token_type: "bearer" }) : String(url).endsWith("GetDatabaseAccessList") ? Response.json([{ DatabaseName: "Blend", DatabaseIdentifier: "ci-primary-only" }, { DatabaseName: "BlendTest", DatabaseIdentifier: "ci-sandbox-only" }]) : Response.json({ ResultCount: 0, ResultSet: [] });
  const fixture = async () => {
    const org = await db.organisation.create({ data: { name: "Sandbox CI", slug: randomUUID() } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "CI", email: randomUUID() + "@example.invalid" } });
    const scope = { organisationId: org.id, userId: user.id, unrestrictedFacilities: true, facilityIds: [] };
    const saved = await saveMriConfiguration(scope, { revision: null, databaseLabel: "Blend", environment: "unknown", login: "ci-login-only", password: "ci-password-only", databaseIdentifier: "ci-primary-only" });
    await checkMriConnection(scope, saved.revision!, fake); return scope;
  };
  try {
    await t.test("sandbox credentials isolate; primary and financial records remain unchanged", async () => {
      const scope = await fixture(), workspace = await mriSandboxWorkspace(scope);
      assert.equal(workspace.storedTestAvailable, true); assert.equal(workspace.configuration.credentialsStored, false);
      const before = await db.integrationConnection.findUniqueOrThrow({ where: { id: `mri:${scope.organisationId}` } });
      const prepared = await prepareStoredMriSandbox(scope, { sourceRevision: workspace.sourceRevision, revision: null });
      assert.equal(prepared.configuration.environment, "test"); assert.equal(prepared.configuration.databaseLabel, "BlendTest"); assert.equal(prepared.configuration.authenticated, false);
      assert.ok(!JSON.stringify(prepared).includes("ci-sandbox-only"));
      const paths: string[] = [];
      const verified = await checkMriConnection(scope, prepared.configuration.revision!, async (url, init) => {
        paths.push(new URL(String(url)).pathname);
        if (String(url).endsWith("SearchProperties")) assert.equal((init!.headers as Record<string, string>).DatabaseIdentifier, "ci-sandbox-only");
        return fake(url, init);
      }, "sandbox");
      assert.equal(verified.databaseReadable, true); assert.equal(verified.propertyCount, 0); assert.equal(verified.postingEnabled, false);
      assert.deepEqual(paths, ["/api/v2/Token", "/api/v2/Access/GetDatabaseAccessList", "/api/v2/Properties/SearchProperties"]);
      assert.deepEqual(await db.integrationConnection.findUniqueOrThrow({ where: { id: before.id } }), before);
      const after = await db.integrationConnection.findUniqueOrThrow({ where: { id: `mri-sandbox:${scope.organisationId}` } });
      assert.notDeepEqual((after.config as Record<string, unknown>).passwordEncrypted, (before.config as Record<string, unknown>).passwordEncrypted);
      const audits = await db.auditEvent.findMany({ where: { organisationId: scope.organisationId } });
      for (const secret of ["ci-access-token-only", "ci-sandbox-only", "ci-login-only", "ci-password-only"]) assert.ok(!JSON.stringify([audits, before, after]).includes(secret));
      assert.equal(await db.webhookOutbox.count({ where: { organisationId: scope.organisationId } }), 0);
      assert.equal(await db.ledgerEntry.count({ where: { account: { customer: { organisationId: scope.organisationId } } } }), 0);
    });
    await t.test("provider discovery must match the test identifier before property reads; failure clears proof", async () => {
      const scope = await fixture(), workspace = await mriSandboxWorkspace(scope);
      const prepared = await prepareStoredMriSandbox(scope, { sourceRevision: workspace.sourceRevision, revision: null });
      const verified = await checkMriConnection(scope, prepared.configuration.revision!, fake, "sandbox");
      let propertyReads = 0;
      const failed = await checkMriConnection(scope, verified.revision!, async (url, init) => {
        if (String(url).endsWith("GetDatabaseAccessList")) return Response.json([{ DatabaseName: "BlendTest", DatabaseIdentifier: "ci-wrong-target" }]);
        if (String(url).endsWith("SearchProperties")) propertyReads++;
        return fake(url, init);
      }, "sandbox");
      assert.equal(propertyReads, 0); assert.equal(failed.databaseReadable, false); assert.equal(failed.authenticated, false); assert.equal(failed.failureCode, "MRI_SANDBOX_TARGET");
    });
    await t.test("organisation scope, source revisions and simultaneous preparation fail closed", async () => {
      const scope = await fixture(), other = await fixture(), workspace = await mriSandboxWorkspace(scope);
      const command = { sourceRevision: workspace.sourceRevision, revision: null };
      await assert.rejects(prepareStoredMriSandbox({ ...scope, unrestrictedFacilities: false }, command), /MRI_ORG_PERMISSION/);
      await assert.rejects(mriSandboxWorkspace({ ...scope, unrestrictedFacilities: false }), /MRI_ORG_PERMISSION/);
      await assert.rejects(prepareStoredMriSandbox(other, command), /MRI_CHANGED/);
      const results = await Promise.allSettled([prepareStoredMriSandbox(scope, command), prepareStoredMriSandbox(scope, command)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(await db.integrationConnection.count({ where: { organisationId: scope.organisationId, provider: "MRI_SANDBOX" } }), 1);
      await assert.rejects(prepareStoredMriSandbox(scope, command), /MRI_CHANGED/);
    });
    await t.test("shared primary target blocks before network and audit failures roll preparation back", async () => {
      const scope = await fixture(), workspace = await mriSandboxWorkspace(scope);
      await assert.rejects(prepareStoredMriSandbox({ ...scope, userId: "ci-nonexistent-actor" }, { sourceRevision: workspace.sourceRevision, revision: null }));
      assert.equal((await mriConfiguration(scope, "sandbox")).credentialsStored, false);
      const prepared = await prepareStoredMriSandbox(scope, { sourceRevision: workspace.sourceRevision, revision: null });
      const verified = await checkMriConnection(scope, prepared.configuration.revision!, fake, "sandbox");
      const primary = await mriConfiguration(scope);
      await saveMriConfiguration(scope, { revision: primary.revision, databaseLabel: "Blend", environment: "live", databaseIdentifier: "ci-sandbox-only" });
      let calls = 0;
      await assert.rejects(checkMriConnection(scope, verified.revision!, async () => { calls++; throw Error("unexpected"); }, "sandbox"), /MRI_SANDBOX_SHARED_TARGET/);
      assert.equal(calls, 0);
      const blocked = await mriSandboxWorkspace(scope); assert.equal(blocked.configuration.databaseReadable, false); assert.equal(blocked.configuration.failureCode, "MRI_SANDBOX_SHARED_TARGET");
    });
    await t.test("settings changed during provider check cannot inherit its proof", async () => {
      const scope = await fixture(), workspace = await mriSandboxWorkspace(scope);
      const prepared = await prepareStoredMriSandbox(scope, { sourceRevision: workspace.sourceRevision, revision: null });
      let edited = false;
      await assert.rejects(checkMriConnection(scope, prepared.configuration.revision!, async (url, init) => {
        if (!edited) { edited = true; const latest = await mriConfiguration(scope); await saveMriConfiguration(scope, { revision: latest.revision, databaseLabel: "Changed", environment: "unknown" }); }
        return fake(url, init);
      }, "sandbox"), /MRI_CHANGED/);
      assert.equal((await mriConfiguration(scope, "sandbox")).databaseReadable, false);
    });
  } finally { await db.$disconnect(); }
});

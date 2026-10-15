import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";

test("receipt review API authenticates before body reads and intersects view, action, ledger and imported-source access", async () => {
  const compiled = await build({ entryPoints: ["src/app/api/v1/billing/unidentified-receipts/route.ts"], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "isolated-receipt-api", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(scope|auth-guards|request-security|payments\/netcash-mandate|unidentified-receipt-service)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("scope") ? "export const requirePermissionScope=(...args)=>globalThis.__receiptApiFixture.authorise(...args);"
      : a.path.endsWith("auth-guards") ? "export const requireSession=async()=>({user:{roleAssignments:[]}});"
      : a.path.endsWith("request-security") ? "export const sameOrigin=request=>request.headers.get('origin')==='https://fixture.invalid';"
      : a.path.endsWith("netcash-mandate") ? "export const boundedBody=async(response,max)=>{const value=Buffer.from(await response.arrayBuffer());if(value.length>max)throw Error('OVERSIZE');return value;};"
      : "export const captureUnidentifiedReceipt=(...args)=>globalThis.__receiptApiFixture.service('capture',args);export const actOnUnidentifiedReceipt=(...args)=>globalThis.__receiptApiFixture.service('act',args);export const unidentifiedReceiptAccounts=(...args)=>globalThis.__receiptApiFixture.service('accounts',args);export const unidentifiedReceiptSources=(...args)=>globalThis.__receiptApiFixture.service('sources',args);export const unidentifiedReceiptWorkspace=(...args)=>globalThis.__receiptApiFixture.service('workspace',args);" }));
  } }] });
  const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  const previous = globalThis.__receiptApiFixture;
  let calls = [], services = [], denied = "", authenticated = true, organisationWide = true;
  globalThis.__receiptApiFixture = {
    authorise: async (permission, facilityId) => { calls.push([permission, facilityId]); if (!authenticated) throw Error("UNAUTHENTICATED"); if (permission === denied) throw Error("FORBIDDEN"); return { userId: "fixture-user", organisationId: "fixture-org", facilityIds: ["store"], unrestrictedFacilities: organisationWide }; },
    service: async (name, args) => { services.push({ name, args }); return name === "workspace" ? { facilities: [], rows: [], nextCursor: null } : { rows: [], id: "synthetic-review" }; },
  };
  const post = body => api.POST(new Request("https://fixture.invalid/api/v1/billing/unidentified-receipts", { method: "POST", headers: { origin: "https://fixture.invalid", "content-type": "application/json" }, body: JSON.stringify(body) }));
  const reset = () => { calls = []; services = []; denied = ""; authenticated = true; organisationWide = true; };
  const propose = { action: "propose", id: "intake", facilityId: "store", revision: 0, accountId: "account", reason: "Original evidence reviewed", confirmed: true };
  try {
    authenticated = false;
    const protectedRequest = { headers: new Headers({ origin: "https://fixture.invalid" }), get body() { throw Error("Private body read before authentication"); } };
    assert.equal((await api.POST(protectedRequest)).status, 401); assert.equal(services.length, 0);
    reset(); denied = "ledger.view"; assert.equal((await post(propose)).status, 403); assert.equal(services.length, 0);
    assert.ok(calls.some(([permission, facility]) => permission === "receipt_review.view" && facility === "store"));
    assert.ok(calls.some(([permission, facility]) => permission === "receipt_review.propose" && facility === "store"));
    reset(); assert.equal((await post({ ...propose, confirmed: false })).status, 422); assert.equal(services.length, 0);
    assert.equal((await post({ ...propose, action: "post" })).status, 422); assert.equal(services.length, 0);
    reset(); assert.equal((await post(propose)).status, 200); assert.equal(services[0].name, "act");
    const imported = { action: "capture", facilityId: "store", requestKey: randomUUID(), source: { sourceType: "BANK_IMPORT_ENTRY", sourceId: "entry", sourceFingerprint: "a".repeat(64) } };
    reset(); denied = "settlements.view"; assert.equal((await post(imported)).status, 403); assert.equal(services.length, 0);
    reset(); organisationWide = false; assert.equal((await post(imported)).status, 409); assert.equal(services.length, 0);
    reset(); assert.equal((await post(imported)).status, 201); assert.equal(services[0].name, "capture"); assert.equal(services[0].args[1].action, undefined);
    reset(); organisationWide = false; assert.equal((await api.GET(new Request("https://fixture.invalid/api?mode=sources"))).status, 409); assert.equal(services.length, 0);
    reset(); denied = "ledger.view"; assert.equal((await api.GET(new Request("https://fixture.invalid/api?mode=accounts&facilityId=store&query=fixture"))).status, 403); assert.equal(services.length, 0);
    reset(); assert.equal((await api.POST(new Request("https://fixture.invalid/api", { method: "POST", headers: { origin: "https://foreign.invalid" }, body: "{}" }))).status, 403); assert.equal(calls.length, 0); assert.equal(services.length, 0);
  } finally { if (previous === undefined) delete globalThis.__receiptApiFixture; else globalThis.__receiptApiFixture = previous; }
});

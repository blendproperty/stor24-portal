import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("signing preparation failure keeps the saved document available for retry", async () => {
  let calls = 0, attached = 0;
  const document = { id: "doc", provider: "BLENDSIGN", status: "PENDING", externalId: null, tenancy: { id: "tenancy", facilityId: "store", paymentMethod: "EFT", startDate: new Date("2026-12-01"), customer: { email: "test@example.invalid" }, facility: { id: "store" }, occupancies: [{ monthlyRate: 1000, unit: { id: "unit" } }] } };
  const mocks = {
    "@/lib/blendsign-client": { createBlendSignLeaseEnvelope: async input => { calls++; assert.equal(input.tenancyId, "tenancy"); if (calls === 1) throw new Error("provider unavailable"); return { envelopeId: "env", status: "SENT" }; } },
    "@/lib/db": { db: { document: { findFirst: async () => document }, user: { findUnique: async () => ({ name: "Staff", email: "staff@example.invalid" }) }, configurationProfile: { findFirst: async () => null }, auditEvent: { create: async () => ({}) } } },
    "@/lib/leasing-service": { attachBlendSignEnvelope: async (_scope, id, envelope) => { assert.equal(id, "doc"); document.externalId = envelope.envelopeId; attached++; } },
  };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/blendsign-lease-service.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; } });
  const scope = { userId: "staff", organisationId: "org", unrestrictedFacilities: false, facilityIds: ["store"] };
  await assert.rejects(mod.exports.retryBlendSignLease(scope, "doc", "ASSISTED"), /provider unavailable/);
  assert.equal(document.externalId, null); assert.equal(attached, 0);
  await mod.exports.retryBlendSignLease(scope, "doc", "ASSISTED");
  assert.equal(document.externalId, "env"); assert.equal(attached, 1); assert.equal(calls, 2);
});

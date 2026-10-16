import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { PDFDocument } from "pdf-lib";

test("staff handbook is a real current PDF with all23 acceptance items and protected audited download", async () => {
  const bytes = await readFile("private/staff-training/stor24-staff-handbook-2026-10-15.pdf");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 22);
  const source = await readFile("docs/STAFF_HANDBOOK_2026-10-15.md", "utf8");
  for (let item = 1; item <= 23; item++) assert.ok(source.includes(`| ${item} |`));
  assert.ok(source.includes("Excel")); assert.ok(source.includes("1 November")); assert.ok(source.includes("12 hours"));
  assert.ok(source.includes("financial")); assert.ok(source.includes("Missing historical email"));
  assert.ok(source.includes("06C")); assert.ok(source.includes("05A")); assert.ok(source.includes("Message delivery history")); assert.ok(source.includes("Load older messages"));
  assert.ok(source.includes("06F")); assert.ok(source.includes("SUBMIT ONE BANK TEST")); assert.ok(source.includes("A retained attempt cannot be replayed"));
  assert.ok(source.includes("06E")); assert.ok(source.includes("Save bank-request permission")); assert.ok(source.includes("guarded submission step"));
  assert.ok(source.includes("06D")); assert.ok(source.includes("Older retained status reads")); assert.ok(source.includes("07A")); assert.ok(source.includes("staff review each run")); assert.ok(source.includes("new run and a new real staff review"));
  let allowed = false, audited = false, auditFailure = false, dlpBlocked = false;
  const scope = { organisationId: "fixture-org", userId: "fixture-staff", facilityIds: ["midpoint"], unrestrictedFacilities: false };
  const bundle = await build({ entryPoints: ["src/app/api/v1/operations/staff-guide/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "handbook-route-boundary", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(scope|db|dlp-transfer-service)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/scope") ? "export const requirePermissionScope=__scope;" : args.path.endsWith("/db") ? "export const db={auditEvent:{create:__audit}};" : "export const guardDlpTransfer=__dlp;" }));
  } }] });
  const loaded = { exports: {} as { GET: () => Promise<Response> } };
  new Function("require", "module", "exports", "__scope", "__audit", "__dlp", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports,
    async (permission: string) => { assert.equal(permission, "operations.view"); if (!allowed) throw new Error("FORBIDDEN"); return scope; },
    async (input: { data: { organisationId: string; actorId: string; after: { sha256: string; byteCount: number } } }) => { if (auditFailure) throw new Error("AUDIT_UNAVAILABLE"); assert.equal(input.data.organisationId, scope.organisationId); assert.equal(input.data.actorId, scope.userId); assert.equal(input.data.after.sha256, createHash("sha256").update(bytes).digest("hex")); assert.equal(input.data.after.byteCount, bytes.byteLength); audited = true; },
    async (input: { actorId: string; resourceId: string; byteLength: number; channel: string }) => { assert.equal(input.actorId, scope.userId); assert.equal(input.resourceId, "staff-handbook-2026-10-15"); assert.equal(input.byteLength, bytes.byteLength); assert.equal(input.channel, "DOWNLOAD"); if (dlpBlocked) throw new Error("DLP_TRANSFER_BLOCKED"); return { "cache-control": "private, no-store" }; });
  assert.equal((await loaded.exports.GET()).status, 403); assert.equal(audited, false);
  allowed = true;
  const response = await loaded.exports.GET(); assert.equal(response.status, 200); assert.equal(audited, true);
  assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.match(response.headers.get("content-type")!, /application\/pdf/); assert.match(response.headers.get("content-disposition")!, /attachment/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  auditFailure = true; assert.equal((await loaded.exports.GET()).status, 500);
  auditFailure = false; dlpBlocked = true; audited = false; assert.equal((await loaded.exports.GET()).status, 422); assert.equal(audited, false);
});

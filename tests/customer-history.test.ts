import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { customerNoteSchema, historyQuerySchema, decodeHistoryCursor, encodeHistoryCursor } from "../src/lib/customer-history-policy";

test("customer notes validate category, body, immutable server fields and bounded filters", () => {
  const input = { facilityId: "store", requestKey: randomUUID(), category: "CALL", body: " A real call note " };
  assert.equal(customerNoteSchema.parse(input).body, "A real call note");
  for (const bad of [{ ...input, body: " " }, { ...input, body: "x".repeat(5001) }, { ...input, category: "APPROVE_REFUND" }, { ...input, authorId: "spoof" }, { ...input, createdAt: "2026-01-01" }]) assert.equal(customerNoteSchema.safeParse(bad).success, false);
  assert.equal(historyQuerySchema.safeParse({ search: "x".repeat(201) }).success, false);
  const cursor = { at: "2026-01-01T00:00:00.000Z", kind: "NOTE" as const, id: "note", snapshot: "2026-10-14T00:00:00.000Z" };
  assert.deepEqual(decodeHistoryCursor(encodeHistoryCursor(cursor)), cursor);
  assert.throws(() => decodeHistoryCursor("invalid"), /HISTORY_CURSOR_INVALID/);
});

test("history HTTP endpoints preserve source permission gates, reject CSRF, and enforce note write permission", async () => {
  let allowed = true, write = false, calls = 0, seen: unknown;
  const scope = { organisationId: "org", userId: "staff", facilityIds: ["store"], unrestrictedFacilities: false };
  const bundle = await build({ entryPoints: ["src/app/api/v1/customers/[customerId]/history/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "history-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(scope|customer-history-service|request-security)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/scope") ? "export const requirePermissionScope=__permission;" : a.path.endsWith("/request-security") ? "export const sameOrigin=r=>r.headers.get('origin')===new URL(r.url).origin;" : "export const customerHistory=async(s,id,q,a)=>__history(a);export const addCustomerNote=async()=>__add();" }));
  } }] });
  const loaded = { exports: {} as { GET: (r: Request, c: unknown) => Promise<Response>; POST: (r: Request, c: unknown) => Promise<Response> } };
  new Function("require", "module", "exports", "__permission", "__history", "__add", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports,
    async (p: string) => { if (!allowed || (p !== "operations.view" && !(p === "operations.manage" && write))) throw new Error("FORBIDDEN"); return scope; },
    async (access: unknown) => { seen = access; calls++; return { entries: [] }; },
    async () => { calls++; return { id: "saved", createdAt: new Date().toISOString() }; });
  const url = "https://example.invalid/api/v1/customers/customer/history", context = { params: Promise.resolve({ customerId: "customer" }) };
  const response = await loaded.exports.GET(new Request(url), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(seen, { communications: null, collections: null, write: null });
  const input = { facilityId: "store", requestKey: randomUUID(), category: "CALL", body: "Called customer" };
  const request = (body = input, origin = "https://example.invalid") => new Request(url, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await loaded.exports.POST(request(), context)).status, 403);
  write = true;
  assert.equal((await loaded.exports.POST(request(input, "https://attacker.invalid"), context)).status, 403);
  assert.equal((await loaded.exports.POST(request({ ...input, body: "" }), context)).status, 422);
  assert.equal(calls, 1);
  assert.equal((await loaded.exports.POST(request(), context)).status, 200);
  allowed = false;
  assert.equal((await loaded.exports.GET(new Request(url), context)).status, 403);
  assert.equal(calls, 2);
});

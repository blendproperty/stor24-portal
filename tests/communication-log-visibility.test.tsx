import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((v: Row) => matches(row, v));
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (value && typeof value === "object") {
      if ("in" in value) return value.in.includes(row[key]);
      if ("some" in value) return (row[key] ?? []).some((v: Row) => matches(v, value.some));
      return matches(row[key] ?? {}, value);
    }
    return row[key] === value;
  });
}
function log(id: string, facilityId: string | null, customerFacility: string, channel = "WHATSAPP") {
  return { id, organisationId: "org", facilityId, customerId: id, channel, direction: "OUTBOUND", status: "FAILED", queuedAt: new Date("2026-09-24T10:00:00Z"), sentAt: null, deliveredAt: null, readAt: null, messageType: "RESERVATION_CONFIRMED", failureCode: "DELIVERY_REVIEW_REQUIRED", metadata: { deliveryOutcome: "UNCERTAIN" }, customer: { organisationId: "org", firstName: id, leads: [{ facilityId: customerFacility }], reservations: [], tenancies: [] }, facility: facilityId ? { name: facilityId } : null };
}
async function fixture() {
  const rows: Row[] = [log("own", "a", "a"), log("own-null", null, "a"), log("OTHER-FACILITY-CUSTOMER", null, "b"), log("other-store", "b", "b"), { ...log("FOREIGN-CUSTOMER", null, "a"), organisationId: "foreign" }];
  const state: Row = { rows, scope: { organisationId: "org", user: { id: "staff" }, allowedFacilityIds: ["a"] }, query: null };
  state.db = { communicationLog: { findMany: async (query: Row) => { state.query = query; return rows.filter(row => matches(row, query.where)); } } };
  const output = await build({ stdin: { contents: 'export {default as Page} from "./src/app/communications/page";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "synthetic-log-view", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|session|auth-guards)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db=__state.db;" : args.path.endsWith("/session") ? "export const getSession=async()=>({role:'Facility manager'});" : "export const requireSession=async()=>({userId:'staff'}); export const requirePermission=async(permission)=>{if(permission!=='operations.view')throw Error('Unexpected permission');return __state.scope;};" }));
  } }] });
  const loaded = { exports: {} as Row };
  new Function("require", "module", "exports", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  return { state, render: async () => renderToStaticMarkup(await loaded.exports.Page()) };
}

test("communications listing restricts unassigned messages to related customers", async () => {
  const f = await fixture();
  const html = await f.render();
  assert.ok(html.includes("own-null"));
  assert.ok(!html.includes("OTHER-FACILITY-CUSTOMER"));
  assert.ok(!html.includes("FOREIGN-CUSTOMER"));
  assert.ok(!html.includes("other-store"));
  assert.equal(f.state.query.take, 100);
  assert.deepEqual(f.state.query.include.customer.select, { firstName: true, lastName: true, companyName: true });
  f.state.scope.allowedFacilityIds = [];
  assert.ok(!(await f.render()).includes("own-null"));
  f.state.scope.allowedFacilityIds = null;
  assert.ok((await f.render()).includes("OTHER-FACILITY-CUSTOMER"));
  assert.ok(!(await f.render()).includes("FOREIGN-CUSTOMER"));
});

test("email/SMS failures are visible without acquiring WhatsApp resend controls", async () => {
  const f = await fixture();
  f.state.rows.splice(0, f.state.rows.length, { ...log("EMAIL-FAILURE", "a", "a", "EMAIL"), sentAt: new Date() }, log("SMS-FAILURE", "a", "a", "SMS"));
  const html = await f.render();
  assert.ok(html.includes("EMAIL-FAILURE")); assert.ok(html.includes("SMS-FAILURE"));
  assert.ok(html.includes("Message delivery log")); assert.ok(html.includes("Channel"));
  assert.ok(html.includes("Review delivery before retrying"));
  assert.ok(!html.includes("Retry WhatsApp"));
  assert.ok(!html.includes(">SENT<"));
});

test("unassigned message scope accepts each leasing relationship and rejects unrelated records", async () => {
  const f = await fixture();
  for (const relationship of ["leads", "reservations", "tenancies"]) {
    const own = log("RELATED-CUSTOMER", null, "a");
    own.customer.leads = [];
    Object.assign(own.customer, { [relationship]: [{ facilityId: "a" }] });
    const unlinked = log("UNLINKED-CUSTOMER", null, "a"); unlinked.customer.leads = [];
    const foreign = log("FOREIGN-RELATION", null, "a"); foreign.customer.organisationId = "foreign";
    const explicitOther = log("EXPLICIT-OTHER", "b", "a");
    f.state.rows.splice(0, f.state.rows.length, own, unlinked, foreign, explicitOther, { ...log("MISSING-CUSTOMER", null, "a"), customer: null });
    const html = await f.render();
    assert.ok(html.includes("RELATED-CUSTOMER"));
    for (const name of ["UNLINKED-CUSTOMER", "FOREIGN-RELATION", "EXPLICIT-OTHER", "MISSING-CUSTOMER"]) assert.ok(!html.includes(name));
  }
});

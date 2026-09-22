import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { catalogueForAssignments, guideAccessRules, type GuideAssignment } from "../src/lib/guided-help-access";
import { workflowGuides } from "../src/lib/guided-help";
import { filterGuides, helpForPath, parseGuidePreferences } from "../src/lib/guided-help-state";

const assignment = (permissions: string[], facilityId: string | null = "store-a", name = "Custom role"): GuideAssignment => ({ facilityId, role: { name, permissions } });
const owner = [assignment(["*"], null, "Organisation owner")];
test("real endpoint returns only the fresh authenticated selection and never caches it", async () => {
  const bundle = await build({ stdin: { contents: 'export { GET } from "./src/app/api/v1/guided-help/route"; export { setAuth } from "@/lib/auth-guards";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "isolated-auth", setup(b) {
    b.onResolve({filter: /^@\/lib\/auth-guards$/}, () => ({path: "auth", namespace: "fixture"}));
    b.onLoad({filter: /.*/, namespace: "fixture"}, () => ({contents: 'let auth; export const setAuth = value => { auth = value; }; export async function requireSession() { if (!auth) throw new Error("UNAUTHENTICATED"); return auth; } export const authErrorResponse = () => Response.json({error:{code:"UNAUTHENTICATED"}}, {status:401});'}));
  } }] });
  const endpoint = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  endpoint.setAuth({user: {roleAssignments: owner}});
  const full = await endpoint.GET();
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  assert.equal((await full.json()).data.guides.length, workflowGuides.length);
  endpoint.setAuth({role: "Organisation owner", user: {roleAssignments: [assignment(["ledger.view"])]}});
  const reduced = (await (await endpoint.GET()).json()).data;
  assert.deepEqual(reduced.guides.map((g: {id: string}) => g.id), ["accounts", "statements"]);
  endpoint.setAuth(null);
  const rejected = await endpoint.GET();
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).data, undefined);
});
test("every authored guide and step has an explicit access policy; owner retains the complete catalogue", () => {
  for (const guide of workflowGuides) assert.equal(guideAccessRules[guide.id]?.steps.length, guide.steps.length, guide.id);
  assert.deepEqual(catalogueForAssignments(owner).guides, workflowGuides);
});

test("facility managers have operational guidance without configuration, credentials, owner actions or admin search results", () => {
  const data = catalogueForAssignments([assignment(["facility.*", "users.view", "operations.*", "inventory.*", "daily_close.*", "configuration.view", "facility_map.view", "phone.view", "reports.view", "reports.export", "communications.view", "integrations.view", "access.view", "access.manage"], "store-a", "Facility manager")]);
  for (const id of ["company", "tenant-defaults", "program-defaults", "settings", "hikvision", "netcash-settings"]) assert.ok(!data.guides.some(g => g.id === id), id);
  assert.ok(data.guides.some(g => g.id === "operations"));
  assert.ok(!JSON.stringify(data).includes("Reset UAT"));
  assert.ok(!JSON.stringify(data).includes("Invite an employee deliberately"));
  assert.ok(!JSON.stringify(data).includes("connection-test forms"));
  assert.equal(filterGuides("App Secret", "All", data.guides).length, 0);
  assert.equal(helpForPath("/settings/integrations/netcash", data.pages).guideId, undefined);
  assert.equal(helpForPath("/company", data.pages).guideId, undefined);
});

test("custom grants, not a role label, determine visibility including added and revoked setup access", () => {
  assert.equal(catalogueForAssignments([assignment([], null, "Organisation owner")]).guides.length, 0);
  const configured = catalogueForAssignments([assignment(["configuration.view", "configuration.manage"], "store-a", "Tailored manager")]);
  assert.ok(configured.guides.some(g => g.id === "program-defaults"));
  assert.ok(!configured.guides.some(g => g.id === "users"));
  assert.equal(catalogueForAssignments([assignment(["configuration.view"])]).guides.length, 0);
  assert.deepEqual(catalogueForAssignments([]), { guides: [], pages: [] });
});

test("read-only users receive reading steps without actions; wildcard view grants do not imply management", () => {
  const data = catalogueForAssignments([assignment(["*.view"])]);
  assert.ok(data.guides.find(g => g.id === "map")?.steps.length === 2);
  assert.ok(!data.guides.some(g => ["payments", "transfer", "move-out", "program-defaults", "settings"].includes(g.id)));
  assert.ok(!data.guides.find(g => g.id === "statements")?.steps.some(s => s.title.includes("Send only")));
  assert.ok(!data.guides.find(g => g.id === "reports")?.steps.some(s => s.title === "Check the export"));
  assert.ok(!data.guides.find(g => g.id === "users")?.steps.some(s => s.title === "Adjust roles and custom permissions"));
});

test("permission combinations cannot be assembled across different facilities", () => {
  const split = [assignment(["ledger.view"], "store-a"), assignment(["payments.manage"], "store-b")];
  assert.ok(!catalogueForAssignments(split).guides.some(g => g.id === "payments"));
  assert.ok(catalogueForAssignments([...split, assignment(["ledger.view"], "store-b")]).guides.some(g => g.id === "payments"));
  assert.ok(catalogueForAssignments([assignment(["ledger.view"], null), assignment(["payments.manage"], "store-b")]).guides.some(g => g.id === "payments"));
});

test("organisation-wide provider/finance tutorials require organisation-wide grants", () => {
  const grants = ["integrations.*", "settlements.*", "mri.*"];
  const scoped = catalogueForAssignments([assignment(grants)]);
  for (const id of ["hikvision", "netcash-settings", "settlements", "mri"]) assert.ok(!scoped.guides.some(g => g.id === id));
  const organisation = catalogueForAssignments([assignment(grants, null)]);
  for (const id of ["hikvision", "netcash-settings", "settlements", "mri"]) assert.ok(organisation.guides.some(g => g.id === id));
});

test("saved or forged owner progress cannot restore removed guides or steps", () => {
  const data = catalogueForAssignments([assignment(["ledger.view"])]);
  const preferences = parseGuidePreferences(JSON.stringify({version: 1, enabled: true, activeGuide: "settings", progress: {
    settings: {step: 1, reviewed: ["settings-1"]}, statements: {step: 3, stepId: "statements-4", reviewed: ["statements-1", "statements-4"]},
  }}), data.guides);
  assert.equal(preferences.activeGuide, null);
  assert.equal(preferences.progress.settings, undefined);
  assert.deepEqual(preferences.progress.statements, {step: 0, reviewed: ["statements-1"]});
});

test("operational offline lessons follow permissions while cached public help contains no staff catalogue", () => {
  const read = catalogueForAssignments([assignment(["operations.view"])]).guides.find(g => g.id === "offline")!;
  assert.deepEqual(read.steps.map(s => s.id), ["offline-1", "offline-2", "offline-7", "offline-8"]);
  const source = readFileSync("src/pwa/offline-guided-help.ts", "utf8");
  assert.ok(!source.includes("guided-help-catalog"));
  assert.ok(source.includes("general device guidance only"));
  const client = readFileSync("src/components/guided-help.tsx", "utf8");
  assert.ok(!client.includes('from "@/lib/guided-help"'));
  const endpoint = readFileSync("src/app/api/v1/guided-help/route.ts", "utf8");
  assert.ok(endpoint.includes("await requireSession()"));
  assert.ok(endpoint.includes("auth.user.roleAssignments"));
  assert.ok(endpoint.includes("private, no-store"));
});

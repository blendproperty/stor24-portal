import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

type Query = { where: Record<string, unknown> };
async function fixture() {
  const reads: { model: string; query: Query }[] = [];
  const state = { denied: new Set<string>(), failed: new Set<string>(), reads,
    scope: { userId: "staff", organisationId: "org", facilityIds: ["store-a"], unrestrictedFacilities: false },
    db: {} as Record<string, unknown> };
  for (const model of ["task", "product", "tenancy", "maintenanceRequest"]) {
    const read = async (query: Query) => {
      reads.push({ model, query });
      if (state.failed.has(model)) throw Error("SYNTHETIC_READ_FAILURE");
      return model === "product" ? [{ quantityOnHand: 5, quantityReserved: 4, reorderPoint: 2 }] : 3;
    };
    state.db[model] = { count: read, findMany: read };
  }
  const result = await build({ entryPoints: ["src/components/operations-reminders.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "reminder-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|scope|collections-service)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__state.db;" : a.path.endsWith("/scope") ? "export const requirePermissionScope=async(p)=>{if(__state.denied.has(p))throw Error('FORBIDDEN');return __state.scope};export const facilityWhere=s=>({organisationId:s.organisationId,...(s.unrestrictedFacilities?{}:{id:{in:s.facilityIds}})});" : "export const collectionsWorkspace=async(scope,today)=>({today,rows:[{ageing:{issue:null,overdue:100},hold:null,nextFollowUp:today}]});" }));
  } }] });
  const loaded = { exports: {} as { OperationsReminders: () => Promise<React.ReactNode> } };
  new Function("require", "module", "exports", "__state", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
  return { state, render: async () => renderToStaticMarkup(await loaded.exports.OperationsReminders()) };
}

test("reminder aggregates enforce permission-specific organisation and facility scope without truncation", async () => {
  const f = await fixture();
  assert.match(await f.render(), /Call past dues/);
  for (const { model, query } of f.state.reads) {
    assert.equal("take" in query, false);
    if (model === "task") {
      assert.equal(query.where.organisationId, "org");
      assert.deepEqual(query.where.facilityId, { in: ["store-a"] });
    } else assert.deepEqual(query.where.facility, { organisationId: "org", id: { in: ["store-a"] } });
  }
  f.state.reads.length = 0;
  f.state.denied.add("inventory.view"); f.state.denied.add("collections.view");
  const html = await f.render();
  assert.doesNotMatch(html, /Reorder|Call past dues/);
  assert.ok(!f.state.reads.some(r => r.model === "product"));
});

test("a failed aggregate is unavailable instead of a reassuring zero; other queues survive", async () => {
  const f = await fixture(); f.state.failed.add("task");
  const html = await f.render();
  assert.match(html, /Count unavailable/); assert.match(html, /Unavailable/);
  assert.match(html, /Service required/); assert.match(html, /1 items/);
});

test("all-denied panel renders no queue and performs no aggregate reads", async () => {
  const f = await fixture();
  for (const p of ["operations.view", "inventory.view", "collections.view", "ledger.view"]) f.state.denied.add(p);
  assert.equal(await f.render(), ""); assert.equal(f.state.reads.length, 0);
});

test("synthetic reminder panel fits desktop and narrow mobile widths", { skip: process.env.REMINDERS_VISUAL !== "1" }, async () => {
  const f = await fixture(); f.state.failed.add("task");
  const html = await f.render();
  const css = (await readFile("src/app/globals.css", "utf8")).replace(/^@import.*$/gm, "");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await mkdir("output/operations-reminders", { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(`<style>${css}</style><main style="padding:16px;max-width:1000px;margin:auto">${html}</main>`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.getByRole("link").count(), 5);
      await page.screenshot({ path: `output/operations-reminders/reminders-${width}.png`, fullPage: true });
    }
  } finally { await browser.close(); }
});

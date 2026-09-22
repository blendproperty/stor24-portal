// Run only against the disposable lab started by identity-upload-lab.mjs.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import pg from "pg";

const base = "http://127.0.0.1:3043", endpoint = "/api/booking/reservations/identity?reference=ST24-LOCAL-ID-TEST";
const database = new pg.Client({ connectionString: "postgresql://lab:local-synthetic-only@127.0.0.1:55440/stor24_identity_lab" });
await database.connect();
const organisations = (await database.query('SELECT slug FROM "Organisation"')).rows;
assert.deepEqual(organisations.map(row => row.slug), ["identity-lab"]);
// Tests run before user handoff and reset only this guarded disposable database.
await database.query('DELETE FROM "AuditEvent"');
await database.query('DELETE FROM "IdentityDocument"');
const browser = await chromium.launch(), context = await browser.newContext(), page = await context.newPage();
const errors = []; page.on("pageerror", error => errors.push(error.message));
const sample = await readFile("output/identity-lab/stor24-test-front.png");
const headers = { origin: base };
async function status() { return (await (await context.request.get(base + endpoint)).json()).data; }
async function documentRow() { return (await database.query('SELECT * FROM "IdentityDocument"')).rows[0]; }
async function upload() {
  await page.getByLabel("Front of your ID card", { exact: true }).setInputFiles("output/identity-lab/stor24-test-front.png");
  await page.getByLabel("Back of your ID card", { exact: true }).setInputFiles("output/identity-lab/stor24-test-back.png");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /^(Upload my document|Upload replacement)$/ }).click();
  await expect(page.getByText("Received · awaiting review", { exact: true })).toBeVisible();
}
try {
  assert.equal((await context.request.get(base + endpoint)).status(), 401);
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Let’s put a name to your space." })).toBeVisible();
  await expect(page.getByLabel("Front of your ID card", { exact: true })).toBeVisible();
  assert.equal((await context.request.post(base + endpoint, { headers: { origin: "https://example.invalid" } })).status(), 403);
  assert.equal((await context.request.get(base + endpoint, { headers: { host: "example.invalid" } })).status(), 403);
  assert.equal((await context.request.get(base + "/api/booking/reservations/identity?reference=OTHER")).status(), 404);
  assert.deepEqual(await (await context.request.get(base + "/lab/gates")).json(), { sign: false, handover: false });
  const initial = await status();
  const form = { expectedVersion: "0", policyHash: initial.policy.hash, acknowledged: "false", documentType: "PASSPORT", pages: { name: "sample.png", mimeType: "image/png", buffer: sample } };
  assert.equal((await context.request.post(base + endpoint, { headers, multipart: form })).status(), 409);
  assert.equal((await context.request.post(base + endpoint, { headers, multipart: { ...form, acknowledged: "true", pages: { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") } } })).status(), 422);
  await mkdir("output/identity-lab", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1050 }); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `output/identity-lab/customer-${width}.png`, fullPage: true });
  }
  await upload();
  let row = await documentRow();
  assert.ok(row.encryptedPages.startsWith("v1."));
  assert.equal(row.encryptedPages.includes(sample.toString("base64")), false);
  assert.equal(JSON.stringify(await status()).includes("encryptedPages"), false);
  assert.deepEqual(await (await context.request.get(base + "/lab/gates")).json(), { sign: true, handover: false });
  assert.equal((await context.request.post(base + "/api/v1/identity-documents", { headers, data: { id: row.id, version: 1, decision: "ACCEPT" } })).status(), 409);
  await page.getByRole("button", { name: "2. Staff review", exact: true }).click();
  await page.getByRole("button", { name: /Sample Customer/ }).click();
  await expect(page.getByRole("button", { name: "Accept document", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open front", exact: true }).click();
  await expect(page.getByRole("img")).toHaveJSProperty("naturalWidth", 800);
  await expect(page.getByRole("button", { name: "Accept document", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept document", exact: true })).toBeEnabled();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "output/identity-lab/staff-320.png", fullPage: true });
  await page.getByRole("button", { name: "Accept document", exact: true }).click();
  await expect(page.getByRole("button", { name: /Sample Customer.*Accepted/ })).toBeVisible();
  assert.deepEqual(await (await context.request.get(base + "/lab/gates")).json(), { sign: true, handover: true });
  await page.getByRole("button", { name: "1. Customer upload", exact: true }).click();
  await expect(page.getByText("Accepted by your store", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove my document", exact: true }).click();
  await expect(page.getByText("Document removed", { exact: true })).toBeVisible();
  assert.equal((await documentRow()).encryptedPages, null);
  assert.deepEqual(await (await context.request.get(base + "/lab/gates")).json(), { sign: false, handover: false });
  await upload(); row = await documentRow();
  assert.equal((await context.request.post(base + "/api/v1/identity-documents", { headers, data: { id: row.id, version: 1, decision: "ACCEPT" } })).status(), 409);
  assert.equal((await context.request.post(base + "/api/v1/identity-documents", { headers, data: { id: row.id, version: row.version, decision: "REPLACE", reason: "Document is incomplete" } })).status(), 200);
  assert.equal((await documentRow()).encryptedPages, null);
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByText("A replacement is needed", { exact: true })).toBeVisible();
  await upload(); row = await documentRow();
  await database.query('UPDATE "IdentityDocument" SET "expiresAt" = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [row.id]);
  await expect.poll(async () => (await documentRow()).encryptedPages, { timeout: 40000 }).toBeNull();
  assert.deepEqual(await (await context.request.get(base + "/lab/gates")).json(), { sign: false, handover: false });
  const previews = await database.query('SELECT count(*)::int AS count FROM "AuditEvent" WHERE action = \'identity_document.previewed\'');
  assert.ok(previews.rows[0].count >= 2);
  assert.deepEqual(errors, []);
  console.log("PASS: real upload, encrypted storage, review of both pages, acceptance, replacement, withdrawal, stale version, timed erasure, signing/handover ID gates, private sessions/origin/host, malformed images and responsive customer/staff screens. No live booking or provider used.");
} finally { await browser.close(); await database.end(); }

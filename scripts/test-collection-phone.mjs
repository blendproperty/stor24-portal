import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ entryPoints: ["tests/browser/collection-phone-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic" });
const css = "body{margin:0;background:#f4f6f8;font-family:Arial,sans-serif}*{box-sizing:border-box}" + await readFile("src/styles/collection-notices.css", "utf8");
const server = createServer((req, res) => { if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].text); } if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); } res.setHeader("Content-Type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(), errors = [], actions = [];
  page.on("pageerror", e => errors.push(e.message));
  const accountId = "cm00000000000000000000001", text = "Account TRAINING-001 · Midpoint\n\nOur records show R100.00 overdue. This reminder does not add fees or change access.";
  let state = null, independent = false, configured = false, held = false, manage = true, uncertain = false;
  await page.route("**/api/v1/collections", route => route.fulfill({ json: { rows: [{ id: accountId, accountNumber: "TRAINING-001", name: "CI customer", facility: "Midpoint" }] } }));
  await page.route("**/api/v1/collections/phone-notices**", async route => {
    const input = route.request().postDataJSON(), channel = input?.channel ?? new URL(route.request().url()).searchParams.get("channel");
    const payload = { channel, recipient: "+27821234567", subject: "STOR24 account payment reminder", text, contentSid: channel === "WHATSAPP" ? "HX" + "a".repeat(32) : null, variables: {}, templateHash: "b".repeat(64), templateVersion: "arrears-phone-v1" };
    if (input) { actions.push(input.action); if (input.action === "prepare") state = { ...payload, id: "collection-phone:" + "a".repeat(64), revision: "00000000-0000-4000-8000-000000000001", status: "DRAFT", sourceCurrent: true }; if (input.action === "approve") state = { ...state, status: "APPROVED", approvedAt: "2026-10-18T08:00:00Z", reference: input.reference }; if (input.action === "send") { state = { ...state, status: uncertain ? "SENDING" : "ACCEPTED" }; if (uncertain) return route.abort("failed"); } if (input.action === "cancel") state = { ...state, status: "CANCELLED" }; }
    await route.fulfill({ json: { source: { accountId, accountNumber: "TRAINING-001", facility: "Midpoint", asOf: "2026-10-18", fingerprint: "a".repeat(64) }, message: payload, blockers: held ? ["The phone number must be verified and consent reviewed."] : [], notice: state ? { ...state, canApprove: independent } : null, canManage: manage, canSend: manage, sendConfigured: configured, deliveryVerified: false } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?account=${accountId}`);
  await expect(page.getByRole("heading", { name: "Recipient and full message" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare / refresh draft" }).click();
  await expect(page.getByRole("button", { name: "Approve reviewed reminder" })).toBeDisabled();
  independent = true; await page.getByRole("button", { name: "Reload notice" }).click();
  await page.getByLabel("Review / cancellation reference").fill("CI independent full-body review"); await page.getByRole("button", { name: "Approve reviewed reminder" }).click();
  await expect(page.getByRole("button", { name: "Send approved SMS" })).toBeDisabled();
  configured = true; await page.getByRole("button", { name: "Reload notice" }).click();
  await expect(page.getByRole("button", { name: "Send approved SMS" })).toBeDisabled();
  await mkdir("output/collection-phone", { recursive: true });
  for (const width of [1440, 1024, 390, 320]) { await page.setViewportSize({ width, height: 950 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `phone notices overflow ${width}`); await page.screenshot({ path: `output/collection-phone/${width}.png`, fullPage: true }); }
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Send approved SMS" }).click();
  await expect(page.getByText("Accepted by the provider.", { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Send approved SMS" })).toHaveCount(0); assert.deepEqual(actions, ["prepare", "approve", "send"]);
  state = null; held = true; await page.getByRole("button", { name: "Reload notice" }).click(); await expect(page.getByRole("button", { name: "Prepare / refresh draft" })).toBeDisabled();
  held = false; manage = false; await page.getByRole("button", { name: "Reload notice" }).click(); await expect(page.getByRole("button", { name: "Prepare / refresh draft" })).toHaveCount(0);
  manage = true; state = { channel: "SMS", recipient: "+27821234567", text, id: "ci-notice", revision: "00000000-0000-4000-8000-000000000001", status: "APPROVED", sourceCurrent: false }; await page.getByRole("button", { name: "Reload notice" }).click(); await expect(page.getByRole("button", { name: "Send approved SMS" })).toBeDisabled();
  state.sourceCurrent = true; uncertain = true; await page.getByRole("button", { name: "Reload notice" }).click(); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Send approved SMS" }).click(); await expect(page.getByRole("alert")).toContainText("send outcome needs review"); await expect(page.getByRole("button", { name: "Send approved SMS" })).toHaveCount(0); await page.getByRole("button", { name: "Reload notice" }).click(); await expect(page.getByText("This attempt is held for delivery review.", { exact: false })).toBeVisible(); assert.deepEqual(actions, ["prepare", "approve", "send", "send"]);
  state = null; await page.getByLabel("Channel", { exact: true }).selectOption("WHATSAPP"); await expect(page.getByText("+27821234567", { exact: true })).toBeVisible(); assert.deepEqual(errors, []);
  console.log("Phone notices: scoped recipient/body preview, independent approval, separate activation/confirmation, consent/stale/view-only holds, uncertain-response reload and four-width layouts PASS. No real messages sent.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

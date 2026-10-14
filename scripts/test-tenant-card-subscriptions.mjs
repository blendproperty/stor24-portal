import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TenantCardSubscriptions}from'./src/components/tenant-card-subscriptions';createRoot(document.getElementById('root')).render(<main className="tenant-portal is-signed-in"><div className="tenant-body"><TenantCardSubscriptions accountId="synthetic-account"/></div></main>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic" });
const css = (await Promise.all(["src/app/globals.css", "src/styles/tenant-portal.css", "src/styles/tenant-dashboard.css"].map(path => readFile(path, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const server = createServer((request, response) => { response.setHeader("content-type", request.url === "/app.js" ? "text/javascript" : request.url === "/style.css" ? "text/css" : "text/html"); response.end(request.url === "/app.js" ? bundle.outputFiles[0].text : request.url === "/style.css" ? css : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  await mkdir("output/tenant-card-subscriptions", { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), page = await context.newPage();
  const posts = [], errors = []; let gatewayPosts = 0;
  page.on("pageerror", error => errors.push(error.message));
  const snapshot = { available: true, request: null, documents: [{ id: "synthetic-invoice", externalId: "CI-INVOICE" }], subscriptions: [], events: [], eventCoverage: "Test transactions are separate from financial receipts." };
  let chosenSchedule;
  await context.route("https://paynow.netcash.co.za/**", async route => { gatewayPosts++; const fields = new URLSearchParams(route.request().postData()); assert.equal(fields.get("p4"), "950.00"); assert.equal(fields.get("m20"), "950.00"); assert.equal(fields.get("m16"), "1"); assert.equal(fields.get("m17"), "12"); await route.fulfill({ contentType: "text/html", body: "<html><body>Isolated gateway fixture. No real payment.</body></html>" }); });
  await page.route("**/api/tenant/card-subscriptions**", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: snapshot } });
    const body = route.request().postDataJSON(); posts.push(body);
    let data;
    if (body.action === "request-preview") { chosenSchedule = body.schedule; data = { fingerprint: "a".repeat(64), monthlyAmount: "950.00", requestText: "I request 12 future monthly payments of R950.00. This request alone does not collect money." }; }
    if (body.action === "request-save") { snapshot.request = { id: "synthetic-request", status: "REQUESTED", terms: { monthlyAmount: "950.00", schedule: chosenSchedule } }; data = { status: "REQUESTED" }; }
    if (body.action === "enrollment-preview") data = { fingerprint: "b".repeat(64), initialAmount: "950.00", monthlyAmount: "950.00", invoiceReference: "CI-INVOICE", schedule: chosenSchedule, consentText: "I authorise R950.00 for this approved unpaid invoice, followed by 12 monthly test payments. Test results do not reduce my account balance." };
    if (body.action === "enroll") { snapshot.subscriptions = [{ id: "synthetic-subscription", status: "SETUP_ISSUED", initialAmount: "950.00", monthlyAmount: "950.00", invoiceReference: "CI-INVOICE", schedule: chosenSchedule }]; data = { subscriptionId: "synthetic-subscription", checkout: { actionUrl: "https://paynow.netcash.co.za/site/paynow.aspx", method: "POST", fields: { m1: "00000000-0000-0000-0000-000000000001", p2: "synthetic-reference", p4: "950.00", m16: "1", m17: "12", m19: chosenSchedule.startDate, m20: "950.00" } } }; }
    if (body.action === "cancellation-preview") data = { subscriptionId: "synthetic-subscription", fingerprint: "c".repeat(64), confirmationText: "Deactivate future test payments. Already initiated transactions still require reconciliation." };
    if (body.action === "cancel") { snapshot.subscriptions[0].status = "CANCELLATION_ACCEPTED"; data = { status: "CANCELLATION_ACCEPTED" }; }
    return route.fulfill({ json: { data } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Review monthly amount", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save monthly payment request", exact: true })).toBeDisabled();
  await page.getByLabel("I accept this monthly-payment request.", { exact: true }).check();
  await page.getByRole("button", { name: "Save monthly payment request", exact: true }).click();
  await page.getByRole("combobox", { name: /Approved unpaid invoice/ }).selectOption("synthetic-invoice");
  await page.getByRole("button", { name: "Review card setup", exact: true }).click();
  await expect(page.getByRole("button", { name: "Prepare Netcash card setup", exact: true })).toBeDisabled();
  await page.getByLabel("I approve this initial amount and future monthly schedule.", { exact: true }).check();
  await page.getByRole("button", { name: "Prepare Netcash card setup", exact: true }).click();
  await expect(page.getByRole("button", { name: "Prepare Netcash card setup", exact: true })).toHaveCount(0);
  const popupPromise = page.waitForEvent("popup"); await page.getByRole("button", { name: "Continue to Netcash card authentication", exact: true }).click();
  const popup = await popupPromise; await popup.waitForLoadState(); await popup.close(); assert.equal(gatewayPosts, 1);
  snapshot.subscriptions[0].status = "SCHEDULE_ACCEPTED";
  snapshot.events = [1, 2].map(index => ({ paymentId: `synthetic-payment-${index}`, subscriptionId: "synthetic-subscription", amount: "950.00", methodLabel: "Credit card", accepted: true, verifiedAt: "2026-10-14T02:00:00Z" }));
  await page.getByRole("button", { name: "Refresh card payment status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Netcash accepted the monthly test schedule", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Netcash card authentication", exact: true })).toHaveCount(0);
  await expect(page.locator(".tenant-card-subscriptions li")).toHaveCount(2);
  for (const width of [1440, 768, 390, 320]) { await page.setViewportSize({ width, height: 1100 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width}`); await page.screenshot({ path: `output/tenant-card-subscriptions/${width}.png`, fullPage: true }); }
  await page.getByRole("button", { name: "Review cancellation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send cancellation to Netcash", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Prepare Netcash card setup", exact: true })).toHaveCount(0);
  await page.getByLabel("I confirm cancellation of future test payments.", { exact: true }).check();
  await page.getByRole("button", { name: "Send cancellation to Netcash", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Netcash accepted cancellation", exact: true })).toBeVisible();
  assert.equal(posts.filter(body => body.action === "enroll").length, 1); assert.equal(posts.filter(body => body.action === "cancel").length, 1); assert.deepEqual(errors, []);
  console.log("Hosted card browser fixture passed: separate review/consent, one mocked gateway submission, retained separate receipts, reviewed cancellation and 1440/768/390/320 layouts. No provider financial request.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

// UI-only synthetic fixtures. No email, customer or financial mutation is performed.
// Supply TEST_RUNTIME_PACKAGE pointing to a package.json with @playwright/test installed.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const require = createRequire(process.env.TEST_RUNTIME_PACKAGE || import.meta.url);
const { chromium } = require("@playwright/test");
const base = process.env.TENANT_TEST_ORIGIN || "http://localhost:3041";
if (new URL(base).hostname !== "localhost") throw new Error("This fixture test is local-only.");
const browser = await chromium.launch({ headless: true });
await mkdir("output/tenant-ui", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let signedIn = false;
    const data = { accounts: [{ id: "sample-own", accountNumber: "SAMPLE-ONLY", balance: "-10.00", currency: "ZAR", tenancy: null }], documents: [], agreements: [], payments: [{ id: "sample-payment", amount: "10.00", currency: "ZAR", processedAt: "2026-09-10T10:00:00Z", account: { accountNumber: "SAMPLE-ONLY" } }], expiresAt: new Date(Date.now() + 1800000).toISOString() };
    await page.route("**/api/tenant/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/auth/start")) return route.fulfill({ json: { message: "Synthetic code requested. No email sent." } });
      if (url.pathname.endsWith("/auth/verify")) { signedIn = true; return route.fulfill({ json: { ok: true } }); }
      if (url.pathname.endsWith("/auth/logout")) { signedIn = false; return route.fulfill({ json: { ok: true } }); }
      if (!signedIn) return route.fulfill({ status: 401, json: { error: "Sign in again." } });
      if (url.pathname.endsWith("/accounts")) return route.fulfill({ json: { data } });
      if (url.pathname.endsWith("/statement") && route.request().method() === "POST") return route.fulfill({ json: { message: "Synthetic secure link. No email sent." } });
      if (url.pathname.endsWith("/statement")) return route.fulfill({ json: { data: { accountNumber: "SAMPLE-ONLY", customerName: "Sample Tenant", currency: "ZAR", openingBalance: "0.00", closingBalance: "-10.00", rows: [{ id: "sample", date: "2026-09-10T10:00:00Z", description: "Sample payment", debit: "0.00", credit: "10.00", balance: "-10.00" }] } } });
      return route.fulfill({ status: 404, json: { error: "Fixture not found" } });
    });
    await page.goto(`${base}/my?organisation=stor24`);
    await page.getByLabel("Email on your STOR24 account").fill("sample@example.invalid");
    await page.getByRole("button", { name: "Email me a sign-in code" }).click();
    await page.getByLabel("Your six-digit code").fill("123456");
    await page.getByRole("button", { name: "Open my account" }).click();
    await page.getByRole("heading", { name: "Everything in its place." }).waitFor();
    await page.getByRole("button", { name: "View statement" }).click();
    await page.getByRole("link", { name: "Download PDF", exact: true }).waitFor();
    assert.match(await page.locator(".tenant-table").innerText(), /Sample payment/);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width + 1, `Page overflow at ${width}`);
    await page.getByRole("button", { name: "Email secure link to me" }).click();
    await page.getByRole("status").filter({ hasText: "Synthetic secure link" }).waitFor();
    await page.screenshot({ path: `output/tenant-ui/account-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Email me a sign-in code" }).waitFor();
    assert.equal(await page.locator(".tenant-table").count(), 0);
    await page.close();
    console.log(`PASS ${width}px: sign-in, account, statement, secure-link action, logout, no overflow (mocked data).`);
  }
} finally { await browser.close(); }

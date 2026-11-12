import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {LeadCustomerPicker} from "./src/components/lead-customer-picker"; createRoot(document.getElementById("root")).render(<LeadCustomerPicker facilityId="store"/>);', resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "iife", jsx: "automatic" });
const server = createServer((req, res) => { if (req.url === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); } else { res.setHeader("content-type", "text/html"); res.end('<div id="root"></div><script src="/fixture.js"></script>'); } });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("**/api/v1/leads/customers?**", async route => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "alice") return route.fulfill({ json: { data: [{ id: "1", firstName: "Alice", lastName: "Example", companyName: null, email: null, phone: null }] } });
    return route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input = page.getByLabel("Find existing customer");
  await input.fill("alice");
  await page.getByRole("button", { name: /Alice Example/ }).waitFor();
  await input.fill("bob");
  assert.equal(await page.getByRole("button", { name: /Alice Example/ }).count(), 0);
  await page.getByText("Could not search customers. Try again.").waitFor();
  assert.equal(await page.getByRole("button", { name: /Alice Example/ }).count(), 0);
  await input.fill("a");
  assert.equal(await page.getByRole("status").count(), 0);
  console.log("PASS stale customer results and error are cleared when search changes");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

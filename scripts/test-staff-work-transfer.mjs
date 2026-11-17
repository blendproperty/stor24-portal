import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const bundle = await build({ stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{UsersWorkspace}from'./src/components/users-workspace';createRoot(document.getElementById('root')).render(<UsersWorkspace/>);", resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, format: "esm", jsx: "automatic" });
const css = ((await readFile("src/app/globals.css", "utf8")) + "\n" + (await readFile("src/styles/stor24-brand.css", "utf8"))).replace('@import "tailwindcss";', "");
let transferred = false;
const server = createServer(async (req, res) => {
  if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
  if (req.url === "/app.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (req.url?.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/work")) {
      if (req.method === "POST") { let body = ""; for await (const chunk of req) body += chunk; const data = JSON.parse(body); if (data.taskId !== "task" || data.replacementId !== "replacement") { res.statusCode = 400; res.end("{}"); return; } transferred = true; res.end(JSON.stringify({ data: { reassigned: true } })); }
      else res.end(JSON.stringify({ data: transferred ? [] : [{ id: "task", kind: "TASK", title: "Call customer", purpose: "GENERAL", status: "OPEN", updatedAt: "2026-11-17T00:00:00.000Z", facility: { name: "Midpoint" }, assigneeId: "target", coverId: null }], truncated: false }));
    } else res.end(JSON.stringify({ data: [], users: [{ id: "target", name: "Target", email: "target@example.invalid", role: "Staff", scope: "Midpoint", permissions: [], active: false }, { id: "replacement", name: "Replacement", email: "replacement@example.invalid", role: "Staff", scope: "Midpoint", permissions: [], active: true }], roles: [], facilities: [] }));
    return;
  }
  res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  for (const width of [1440, 390, 320]) {
    transferred = false;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel("Show inactive users").check();
    await page.getByRole("row").filter({ hasText: "Target" }).getByRole("button", { name: "Delete user" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Call customer")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reassign" })).toBeDisabled();
    await dialog.getByLabel("Reassign to").selectOption("replacement");
    await dialog.getByRole("button", { name: "Reassign" }).click();
    await expect(dialog.getByText("No outstanding tasks or enquiries found.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Permanently delete user" })).toBeVisible();
    await page.close();
  }
} finally { await browser.close(); server.close(); }

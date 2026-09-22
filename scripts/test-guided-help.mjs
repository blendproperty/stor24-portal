/** Real client components with isolated fixtures. No production access or writes. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const catalogueBundle = await build({ entryPoints: ["src/lib/guided-help.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { workflowGuides } = await import(`data:text/javascript;base64,${Buffer.from(catalogueBundle.outputFiles[0].text).toString("base64")}`);
const accessBundle = await build({ entryPoints: ["src/lib/guided-help-access.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { catalogueForAssignments } = await import(`data:text/javascript;base64,${Buffer.from(accessBundle.outputFiles[0].text).toString("base64")}`);
let guidePersona = [{facilityId: null, role: {name: "Organisation owner", permissions: ["*"]}}];
let guideAccessDenied = false;
const navigation = `import React, {useSyncExternalStore} from 'react';
const subscribe = cb => { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb); };
const read = () => window.location.pathname + window.location.search;
export const usePathname = () => useSyncExternalStore(subscribe, read, () => '/').split('?')[0];
export const useRouter = () => ({push(href) { history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, replace(href) { history.replaceState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, refresh() {}});
export const Link = ({href, children, ...props}) => React.createElement('a', {...props, href, onClick: e => {e.preventDefault(); history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate'));}}, children);
export const Image = ({unoptimized, priority, ...props}) => React.createElement('img', props);`;
const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/browser/guided-help-fixture.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic", plugins: [{ name: "isolated-fixture", setup(b) {
  b.onResolve({filter: /^next\/(navigation|link|image)$/}, args => ({path: args.path, namespace: "fixture"}));
  b.onLoad({filter: /.*/, namespace: "fixture"}, args => ({contents: navigation + (args.path === "next/link" ? "\nexport default Link;" : args.path === "next/image" ? "\nexport default Image;" : ""), loader: "jsx", resolveDir: root}));
  b.onResolve({filter: /^@\/app\/actions\//}, args => ({path: args.path, namespace: "actions"}));
  b.onLoad({filter: /.*/, namespace: "actions"}, () => ({contents: "export async function confirmReservationMoveInAction() { throw new Error('Unexpected handover'); } export async function recordReservationPaymentAction() { throw new Error('Unexpected payment'); }"}));
} }] });
const style = (await Promise.all(["src/app/globals.css", "src/styles/stor24-brand.css", "src/styles/guided-help.css"].map(file => readFile(file, "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const customer = { id: "fixture-customer", firstName: "Example", lastName: "Customer", companyName: null, email: "fixture@example.invalid", phone: null };
const unit = {id: "fixture-unit", facilityId: "fixture-store", number: "T01", monthlyRate: "1200", unitType: {name: "Training unit", areaSqMetres: "9"}};
const data = { facilities: [{id: "fixture-store", name: "Training store", units: [unit]}], customers: [customer], reservations: [{id: "fixture-reservation", status: "ACTIVE", quotedRate: "1200", holdExpiresAt: "2026-09-30T12:00:00Z", intendedMoveIn: "2026-09-30T12:00:00Z", createdAt: "2026-09-21T12:00:00Z", facility: {id: "fixture-store", name: "Training store"}, customer, unit, lead: null, convertedTenancy: null}] };
const writes = [];
const server = createServer(async (req, res) => {
  if (req.method !== "GET") { writes.push(`${req.method} ${req.url}`); res.writeHead(405); res.end(); return; }
  const url = new URL(req.url, "http://localhost");
  if (["/offline-workspace.html", "/offline-workspace.css", "/offline-workspace.js", "/offline-guided-help.js", "/offline-guided-help.css"].includes(url.pathname)) {
    res.setHeader("content-type", url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".css") ? "text/css" : "text/html");
    res.end(await readFile(path.join(root, "public", url.pathname))); return;
  }
  if (url.pathname === "/api/v1/offline/snapshot") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: { facilities: [{id: "fixture-store", name: "Training facility with a deliberately long location name", code: "LONG-TRAINING-STORE"}] } })); return; }
  if (url.pathname === "/api/v1/guided-help") {
    res.setHeader("content-type", "application/json");
    if (guideAccessDenied) { res.writeHead(401); res.end(JSON.stringify({error: "UNAUTHENTICATED"})); return; }
    res.end(JSON.stringify({data: catalogueForAssignments(guidePersona)})); return;
  }
  if (url.pathname === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/fixture.css") { res.setHeader("content-type", "text/css"); res.end(style); return; }
  if (url.pathname === "/api/v1/reservations") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({data})); return; }
  if (url.pathname.startsWith("/brand/")) {
    try { res.setHeader("content-type", url.pathname.endsWith(".svg") ? "image/svg+xml" : "font/ttf"); res.end(await readFile(path.join(root, "public", url.pathname))); }
    catch { res.writeHead(404); res.end(); } return;
  }
  res.setHeader("content-type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>@font-face{font-family:Satoshi;src:url(/brand/Satoshi-Variable.ttf)}body{--font-satoshi:Satoshi}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {});
const results = [];
const errors = [];
await mkdir("output/guided-help", {recursive: true});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: "reduce"});
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const panel = page.locator("#guided-help-panel");
  await page.goto(base);
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", {name: "Guide me", exact: false}).click();
  await expect(page.getByRole("switch", {name: "Guide mode"})).toHaveAttribute("aria-checked", "false");
  await expect(panel.getByRole("heading", {name: "Your operational overview"})).toBeVisible();
  await page.screenshot({path: "output/guided-help/desktop-library.png"});
  await panel.getByRole("button", {name: /01 Find your way around/}).click();
  await expect(panel.getByRole("heading", {name: "Start with the operational overview"})).toBeVisible();
  await panel.getByRole("button", {name: "Show me on this page"}).click();
  await expect(page.locator(".guide-highlight")).toBeVisible();
  await page.screenshot({path: "output/guided-help/desktop-tour.png"});
  await panel.getByRole("button", {name: "Read & next"}).click();
  await expect(panel.getByRole("heading", {name: "Work through what needs attention"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", {name: /Guide me/})).toBeFocused();
  await page.reload();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", {name: /Guide me/}).click();
  await panel.getByRole("button", {name: /Continue where you left off/}).click();
  await expect(panel.getByRole("heading", {name: "Work through what needs attention"})).toBeVisible();
  await panel.getByRole("button", {name: "Restart", exact: true}).click();
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  for (let i = 0; i < 3; i++) await panel.getByRole("button", {name: "Read & next"}).click();
  await panel.getByRole("button", {name: "Finish reading"}).click();
  await expect(panel.getByRole("heading", {name: "You’ve read every step."})).toBeVisible();
  await expect(panel.getByText(/does not confirm that any customer task/)).toBeVisible();
  results.push("Dashboard tour, highlight, keyboard exit/focus, reload/resume, restart and reading completion");

  await panel.getByRole("switch").click();
  await expect(panel.getByRole("heading", {name: "Choose a workflow"})).toBeVisible();
  await page.reload();
  await page.getByRole("button", {name: /Guide me/}).click();
  await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await page.goto(`${base}/?user=fixture-staff-b`);
  await page.getByRole("button", {name: /Guide me/}).click();
  await expect(panel.locator(".guide-card").first()).not.toContainText("read");
  results.push("Persisted switch-off and separate user progress");

  await page.goto(`${base}/reservations`);
  await page.getByRole("button", {name: /Guide me/}).click();
  await panel.getByRole("button", {name: "Guide me through this"}).click();
  await panel.getByRole("button", {name: "Show me on this page"}).click();
  await expect(page.locator(".guide-highlight")).toBeVisible();
  await page.getByPlaceholder("Customer, unit or type").fill("Example");
  await expect(page.getByRole("cell", {name: "Example Customer fixture@example.invalid", exact: true})).toBeVisible();
  await panel.getByRole("button", {name: "Read & next"}).click();
  await panel.getByRole("button", {name: "Read & next"}).click();
  await page.getByRole("button", {name: "New reservation", exact: true}).click();
  await expect(page.locator(".reservation-modal")).toBeVisible();
  await page.locator(".reservation-modal").getByRole("button", {name: "Cancel", exact: true}).click();
  await expect(page.locator(".reservation-modal")).toHaveCount(0);
  await panel.getByRole("button", {name: "All guides"}).click();
  await panel.getByRole("button", {name: /03 Prepare a move-in/}).click();
  await page.getByRole("link", {name: "Move in", exact: true}).click();
  await expect(page).toHaveURL(/move-in\?reservation=fixture-reservation/);
  await expect(page.getByRole("heading", {name: "Move-in checks", exact: true})).toBeVisible();
  await panel.getByRole("button", {name: "Read & next"}).click();
  await panel.getByRole("button", {name: "Read & next"}).click();
  await panel.getByRole("button", {name: "Show me on this page"}).click();
  await expect(page.locator(".guide-highlight")).toBeVisible();
  await expect(page.getByRole("button", {name: "Confirm move-in / key handover"})).toBeDisabled();
  await page.screenshot({path: "output/guided-help/desktop-move-in.png"});
  results.push("Real reservations component filter/modal, cross-page guide continuity and blocked signed-booking handover");

  await page.goto(`${base}/operations/move-in?reservation=fixture-reservation&unsigned=1`);
  await page.getByRole("button", {name: /Guide me/}).click();
  await panel.getByRole("button", {name: /Continue where you left off/}).click();
  await panel.getByRole("button", {name: "Show me on this page"}).click();
  await expect(panel.getByRole("status")).toContainText("unsigned agreement path");
  await expect(page.locator(".guide-highlight")).toHaveCount(0);
  results.push("Missing signed-booking target gives truthful unsigned-path guidance");

  const other = await context.newPage();
  await other.goto(base);
  await other.getByRole("button", {name: /Guide me/}).click();
  await other.getByRole("switch").click();
  await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await expect(panel.getByRole("heading", {name: "Choose a workflow"})).toBeVisible();
  await other.close();
  results.push("Cross-tab switch-off clears active guidance");

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(`${base}/operations/move-in?reservation=fixture-reservation`);
    await page.getByRole("button", {name: /Guide me/}).click();
    await panel.getByRole("button", {name: "Guide me through this"}).click();
    await panel.getByRole("button", {name: "Read & next"}).click();
    await panel.getByRole("button", {name: "Show me on this page"}).click();
    await page.screenshot({path: `output/guided-help/move-in-${width}.png`});
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    assert.ok(box.y >= 0 && box.y + box.height <= 901);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `No horizontal overflow at ${width}px`);
    await expect(panel.getByRole("button", {name: "Close guided help"})).toBeVisible();
    await panel.getByRole("button", {name: "Pause", exact: true}).click();
    await expect(panel).toHaveCount(0);
  }
  results.push("390, 768 and 1280px panel bounds, scrolling, close and no horizontal overflow");

  const denied = await browser.newContext();
  await denied.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Unavailable", "SecurityError"); }; });
  const deniedPage = await denied.newPage();
  await deniedPage.goto(base);
  await deniedPage.getByRole("button", {name: /Guide me/}).click();
  await deniedPage.locator(".guide-card").first().click();
  await expect(deniedPage.getByText(/Browser storage is unavailable/)).toBeVisible();
  await deniedPage.getByRole("button", {name: "Read & next"}).click();
  await expect(deniedPage.getByRole("heading", {name: "Work through what needs attention"})).toBeVisible();
  await denied.close();
  results.push("Storage denial leaves guidance functional with an honest persistence notice");

  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(`${base}/?user=catalogue-reader`);
  await page.getByRole("button", {name: /Guide me/}).click();
  await panel.getByLabel("Search guides").fill("deposit refund");
  await expect(panel.locator(".guide-card").filter({hasText: "Complete a move-out"})).toBeVisible();
  await panel.getByLabel("Work area").selectOption("Offline work");
  await expect(panel.getByText("No matching guides.", {exact: false})).toBeVisible();
  await panel.getByRole("button", {name: "Clear filters"}).click();
  await expect(panel.locator(".guide-card")).toHaveCount(workflowGuides.length);
  await page.screenshot({path: "output/guided-help/expanded-library.png"});
  // Walk every authored step through the real tutorial UI. Business screens remain fixtures.
  for (const guide of workflowGuides) {
    console.log(`Checking guide: ${guide.id}`);
    await panel.getByLabel("Search guides").fill(guide.title);
    await panel.locator(".guide-card").filter({has: page.getByText(guide.title, {exact: true})}).click();
    for (let index = 0; index < guide.steps.length; index++) {
      await expect(panel.locator(".guide-step h3")).toHaveText(guide.steps[index].title);
      await panel.getByRole("button", {name: index === guide.steps.length - 1 ? "Finish reading" : "Read & next"}).click();
    }
    await expect(panel.getByRole("heading", {name: "You’ve read every step."})).toBeVisible();
    await panel.getByRole("button", {name: "Explore another guide"}).click();
  }
  results.push(`Search, category, empty state and all ${workflowGuides.length} guides / ${workflowGuides.reduce((n, g) => n + g.steps.length, 0)} steps rendered and completed`);

  await page.goto(`${base}/operations/accounts/example/statement`);
  await page.getByRole("button", {name: /Guide me/}).click();
  await panel.getByRole("button", {name: "Guide me through this"}).click();
  await panel.getByRole("button", {name: "Read & next"}).click();
  await expect(panel.getByRole("button", {name: "Show me on this page"})).toBeVisible();
  await panel.getByRole("button", {name: "Show me on this page"}).click();
  await expect(panel.getByRole("status")).toContainText("Account statement");
  results.push("Dynamic account statement uses the real URL and handles an absent selected-record target");

  // Real catalogue policy, custom names, restricted routes, stale progress and live revocation.
  guidePersona = [{facilityId: "fixture-store", role: {name: "Custom facility role", permissions: ["operations.*", "inventory.*", "configuration.view", "users.view", "facility_map.view", "reports.view", "integrations.view", "communications.view"]}}];
  await page.goto(`${base}/company`);
  await page.getByRole("button", {name: /Guide me/}).click();
  await expect(panel.locator(".guide-card").first()).toBeVisible();
  for (const forbidden of ["Program defaults", "Store setup and public visibility", "Netcash test credentials", "Settings, sign-in"]) await expect(panel).not.toContainText(forbidden);
  await expect(panel.getByRole("button", {name: "Guide me through this"})).toHaveCount(0);
  await panel.getByRole("searchbox").fill("App Secret");
  await expect(panel.locator(".guide-card")).toHaveCount(0);
  await panel.getByRole("searchbox").fill("");
  const unitCard = panel.locator(".guide-card").filter({hasText: "Units & rates: your available tasks"});
  await unitCard.click();
  await expect(panel).not.toContainText("Reset UAT");
  await expect(panel.locator(".guide-checklist")).not.toContainText("Keep UAT reset");
  await page.screenshot({path: "output/guided-help/facility-permissions.png"});
  // Permission loss while a guide is active is detected on window focus.
  guidePersona = [];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel.locator(".guide-step")).toHaveCount(0);
  await expect(panel.locator(".guide-card")).toHaveCount(0);
  await expect(page.locator(".guide-highlight")).toHaveCount(0);
  guideAccessDenied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel.getByRole("status")).toContainText("could not confirm");
  guideAccessDenied = false;
  guidePersona = [{facilityId: "fixture-store", role: {name: "Custom read only", permissions: ["ledger.view"]}}];
  // Even forged persisted admin progress cannot restore an unavailable guide.
  await page.evaluate(() => localStorage.setItem("stor24:guided-help:v1:fixture-staff-a", JSON.stringify({version:1,enabled:true,activeGuide:"program-defaults",progress:{"program-defaults":{step:2,reviewed:[]}}})));
  await page.goto(`${base}/settings`);
  await page.getByRole("button", {name: /Guide me/}).click();
  await expect(panel.locator(".guide-card")).toHaveCount(2);
  await expect(panel.getByRole("button", {name: /Continue where you left off/})).toHaveCount(0);
  await expect(panel).not.toContainText("Program defaults");
  await panel.locator(".guide-card").filter({hasText: "Statements"}).count();
  await panel.locator(".guide-card").last().click();
  await expect(panel.locator(".guide-checklist")).not.toContainText("Send only");
  results.push("Facility/custom/read-only roles, restricted search/context/steps, forged admin progress, active revocation and session failure all fail closed");

  await page.goto(`${base}/offline-workspace.html`);
  const offlinePanel = page.locator("#offline-guide");
  await page.getByRole("button", {name: "Guide me", exact: true}).click();
  await page.getByRole("switch", {name: "Offline guide mode"}).click();
  await offlinePanel.getByRole("button", {name: "Show me on this page"}).click();
  await expect(page.locator("#setup-panel")).toHaveClass(/offline-guide-highlight/);
  await offlinePanel.getByRole("button", {name: "Read & next"}).click();
  await page.reload();
  await page.getByRole("button", {name: "Guide me", exact: true}).click();
  await expect(offlinePanel.getByRole("heading", {name: "Unlock and inspect the snapshot"})).toBeVisible();
  // Simulated network loss: cached/read assets are already loaded. No snapshot unlocked or changed.
  await context.setOffline(true);
  await offlinePanel.getByRole("button", {name: "Read & next"}).click();
  await offlinePanel.getByRole("button", {name: "Show me on this page"}).click();
  await expect(offlinePanel.getByRole("status")).toContainText("Unlock the snapshot");
  await page.setViewportSize({width: 390, height: 844});
  const offlineBox = await offlinePanel.boundingBox();
  assert.ok(offlineBox.x >= 0 && offlineBox.x + offlineBox.width <= 390);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Long facility names must not overflow the offline mobile page");
  await page.screenshot({path: "output/guided-help/offline-mobile.png"});
  await page.keyboard.press("Escape");
  await expect(offlinePanel).toBeHidden();
  await page.getByRole("button", {name: "Guide me", exact: true}).click();
  await page.getByRole("switch", {name: "Offline guide mode"}).click();
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", {name: "Guide me", exact: true}).click();
  await expect(page.getByRole("switch", {name: "Offline guide mode"})).toHaveAttribute("aria-checked", "false");
  results.push("Actual offline page: highlights, pause, reload/resume, switch persistence, hidden-target guidance, network loss and 390px bounds");

  assert.deepEqual(writes, [], "Guidance did not submit any operational request");
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(JSON.stringify({passed: results, operationalWrites: writes.length, browserErrors: errors.length}, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

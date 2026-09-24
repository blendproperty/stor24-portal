import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { emptyGuidePreferences, filterGuides, guideStorageKey, helpForPath, pageHelp, parseGuidePreferences, reviewGuideStep, stepMatchesPath, workflowGuides } from "../src/lib/guided-help";

test("tutorial state safely recovers from unavailable, corrupt and obsolete browser storage", () => {
  for (const raw of [null, "{broken", "null", "[]", '{"version":99,"enabled":true}']) {
    assert.deepEqual(parseGuidePreferences(raw), emptyGuidePreferences);
  }
});

test("restored progress accepts known steps only and bounds the position", () => {
  const result = parseGuidePreferences(JSON.stringify({ version: 1, enabled: "true", activeGuide: "javascript:alert(1)", progress: {
    orientation: { step: 999, reviewed: ["overview", "overview", "unknown", "activity"] },
    reservations: { step: -12, reviewed: "find" },
    "move-in": { step: 1.5, reviewed: ["payment"] },
    fake: { step: 0, reviewed: ["fake"] },
  } }));
  assert.equal(result.enabled, false);
  assert.equal(result.activeGuide, null);
  assert.deepEqual(result.progress.orientation, { step: 3, reviewed: ["overview", "activity"] });
  assert.deepEqual(result.progress.reservations, { step: 0, reviewed: [] });
  assert.deepEqual(result.progress["move-in"], { step: 0, reviewed: ["payment"] });
  assert.equal(result.progress.fake, undefined);
});

test("reading a step is idempotent and does not credit skipped steps", () => {
  const first = reviewGuideStep(emptyGuidePreferences, "orientation", 0);
  const repeat = reviewGuideStep(first, "orientation", 0);
  assert.deepEqual(repeat, first);
  const last = reviewGuideStep(repeat, "orientation", 3);
  assert.deepEqual(last.progress.orientation, { step: 3, reviewed: ["overview", "activity"] });
  assert.deepEqual(emptyGuidePreferences.progress, {});
  assert.equal(reviewGuideStep(last, "unknown", 0), last);
  assert.equal(reviewGuideStep(last, "orientation", 999), last);
});

test("switch-off and per-user progress survive a save/read round trip without cross-user keys", () => {
  const first = reviewGuideStep({ ...emptyGuidePreferences, enabled: true }, "move-in", 2);
  const disabled = { ...first, enabled: false };
  assert.deepEqual(parseGuidePreferences(JSON.stringify(disabled)), disabled);
  assert.notEqual(guideStorageKey("staff-a"), guideStorageKey("staff-b"));
  assert.notEqual(guideStorageKey("staff/a"), guideStorageKey("staff%2Fa"));
});

test("page help selects exact or most specific parent routes without prefix collisions", () => {
  assert.equal(helpForPath("/operations/move-in").title, "Move in");
  assert.equal(helpForPath("/operations/merchandise/orders").title, "Merchandise");
  assert.equal(helpForPath("/billing/netcash").title, "Netcash operations");
  assert.equal(helpForPath("/operations-other").title, "Help with this page");
  assert.equal(helpForPath("/new-screen").title, "Help with this page");
});

test("editorial guide destinations are fixed staff read screens and IDs are unique", () => {
  assert.equal(new Set(workflowGuides.map(guide => guide.id)).size, workflowGuides.length);
  const allowedRoutes = new Set(pageHelp.map(page => page.route));
  for (const guide of workflowGuides) {
    assert.equal(new Set(guide.steps.map(step => step.id)).size, guide.steps.length);
    for (const step of guide.steps) {
      assert.ok(allowedRoutes.has(step.route));
      assert.match(step.target, /^[a-z-]+$/);
      assert.ok(step.missing.length > 0);
    }
  }
});

test("every staff page and navigation destination has a substantive contextual tutorial", () => {
  const publicPages = new Set(["/privacy", "/paia", "/login", "/forgot-password", "/reset-password/[token]", "/invite/[token]", "/setup/[token]", "/sign/[token]", "/my", "/my/orders/[id]"]);
  const routes = readdirSync("src/app", { recursive: true }).map(String).map(path => path.replaceAll("\\", "/"))
    .filter(path => path === "page.tsx" || path.endsWith("/page.tsx"))
    .map(path => path === "page.tsx" ? "/" : `/${path.slice(0, -9)}`).filter(route => !publicPages.has(route));
  const nav = readFileSync("src/components/app-shell.tsx", "utf8");
  routes.push(...Array.from(nav.matchAll(/href: "([^"]+)"/g), match => match[1]), "/offline-workspace.html");
  for (const route of new Set(routes)) {
    const page = pageHelp.find(item => item.route === route);
    assert.ok(page && "guideId" in page && page.guideId, `Missing contextual guide for ${route}`);
    const guide = workflowGuides.find(item => item.id === page.guideId);
    assert.ok(guide && guide.steps.length >= 3, `Incomplete workflow for ${route}`);
    assert.ok(guide.steps.every(step => step.body.length >= 100 && step.missing.length > 30));
  }
});

test("statement guidance preserves real account URLs and does not match adjacent routes", () => {
  const step = workflowGuides.find(item => item.id === "statements")!.steps[1];
  assert.equal(helpForPath("/operations/accounts/real-id/statement").guideId, "statements");
  assert.equal(stepMatchesPath(step, "/operations/accounts/real-id/statement"), true);
  assert.equal(stepMatchesPath(step, "/operations/accounts/real-id"), false);
  assert.equal(step.route, "/operations/accounts");
});

test("search finds workflow details across titles and steps and combines category filters", () => {
  assert.ok(filterGuides("deposit refund").some(item => item.id === "move-out"));
  assert.ok(filterGuides("DebiCheck").some(item => item.id === "netcash-settings"));
  assert.equal(filterGuides("DebiCheck", "Customer journey").length, 0);
  assert.equal(filterGuides("   ").length, workflowGuides.length);
  assert.equal(filterGuides("no-such-workflow-xyz").length, 0);
});

test("all program-default tabs remain represented when setup is extended", () => {
  const source = readFileSync("src/components/program-defaults.tsx", "utf8");
  const tabs = Array.from(source.match(/const tabs = \[([^\]]+)\]/)![1].matchAll(/"([^"]+)"/g), match => match[1]);
  const titles = workflowGuides.find(item => item.id === "program-defaults")!.steps.map(step => step.title);
  for (const tab of tabs) assert.ok(titles.includes(tab), `Missing ${tab} tutorial`);
});

test("offline guidance assets are cached and contain no operational writes", () => {
  const worker = readFileSync("src/pwa/service-worker-template.js", "utf8");
  for (const path of ["/offline-guided-help.js", "/offline-guided-help.css"]) assert.ok(worker.includes(`"${path}"`));
  const source = readFileSync("src/pwa/offline-guided-help.ts", "utf8");
  assert.doesNotMatch(source, /fetch\(|indexedDB|\.submit\(|requestSubmit\(/);
});

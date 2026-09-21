import assert from "node:assert/strict";
import test from "node:test";
import { emptyGuidePreferences, guideStorageKey, helpForPath, parseGuidePreferences, reviewGuideStep, workflowGuides } from "../src/lib/guided-help";

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
  assert.equal(helpForPath("/billing/netcash").title, "Billing & payments");
  assert.equal(helpForPath("/operations-other").title, "Help with this page");
  assert.equal(helpForPath("/new-screen").title, "Help with this page");
});

test("editorial guide destinations are fixed staff read screens and IDs are unique", () => {
  assert.equal(new Set(workflowGuides.map(guide => guide.id)).size, workflowGuides.length);
  const allowedRoutes = new Set(["/", "/reservations", "/operations/move-in"]);
  for (const guide of workflowGuides) {
    assert.equal(new Set(guide.steps.map(step => step.id)).size, guide.steps.length);
    for (const step of guide.steps) {
      assert.ok(allowedRoutes.has(step.route));
      assert.match(step.target, /^[a-z-]+$/);
      assert.ok(step.missing.length > 0);
    }
  }
});

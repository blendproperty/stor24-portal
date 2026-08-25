import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceWorkerPath = new URL("../src/pwa/service-worker-template.js", import.meta.url);
const offlineShellPath = new URL("../public/offline.html", import.meta.url);

test("PWA caches only the offline shell and approved brand assets", async () => {
  const source = await readFile(serviceWorkerPath, "utf8");

  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /fetch\(request\)\.catch\(\(\) => caches\.match\("\/offline\.html"\)\)/);
  assert.match(source, /url\.pathname\.startsWith\("\/brand\/"\)/);
  assert.match(source, /url\.pathname\.startsWith\("\/icons\/"\)/);

  assert.doesNotMatch(source, /indexedDB|localStorage|sessionStorage|BackgroundSync|sync\.register/i);
  assert.doesNotMatch(source, /\/accounts|\/customers|\/payments|\/documents|\/biometrics/);
});

test("offline shell returns to the live portal after manual or automatic reconnection", async () => {
  const source = await readFile(offlineShellPath, "utf8");

  assert.match(source, /onclick="location\.replace\('\/'\)"/);
  assert.match(source, /addEventListener\("online",\(\)=>location\.replace\("\/"\)\)/);
  assert.doesNotMatch(source, /location\.reload\(\)/);
});

test("each build replaces older STOR 24 shell caches", async () => {
  const source = await readFile(serviceWorkerPath, "utf8");

  assert.match(source, /stor24-shell-__BUILD_VERSION__/);
  assert.match(source, /key\.startsWith\("stor24-shell-"\) && key !== CACHE_VERSION/);
  assert.match(source, /caches\.delete\(key\)/);
  assert.match(source, /self\.skipWaiting\(\)/);
  assert.match(source, /self\.clients\.claim\(\)/);
});

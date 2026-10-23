import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const healthRoute = readFileSync(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8");
const compose = readFileSync(new URL("../compose.prod.yml", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../.github/workflows/monitor-production.yml", import.meta.url), "utf8");

test("production health performs a database readiness check", () => {
  assert.match(healthRoute, /db\.\$queryRaw`SELECT 1`/);
  assert.match(healthRoute, /status: "degraded"/);
  assert.match(healthRoute, /status: 503/);
  assert.doesNotMatch(healthRoute, /force-static/);
});

test("externally scheduled production monitoring verifies readiness without a duplicate GitHub cron", () => {
  assert.match(monitor, /workflow_dispatch:/);
  assert.doesNotMatch(monitor, /^\s+schedule:/m);
  const worker = JSON.parse(readFileSync(new URL("../wrangler.monitor.json", import.meta.url), "utf8"));
  assert.deepEqual(worker.triggers.crons, ["3,13,23,33,43,53 * * * *"]);
  assert.match(monitor, /status !== "ok"/);
  assert.match(monitor, /database !== "ok"/);
});

test("the container healthcheck consumes the readiness endpoint", () => {
  assert.match(compose, /healthcheck:[\s\S]*\/api\/health/);
});


test("monitor retries connection establishment, retains fail-closed checks and uses authenticated SMTP", () => {
  assert.equal((monitor.match(/ConnectionAttempts=3/g) || []).length, 2);
  assert.match(monitor, /StrictHostKeyChecking=yes/);
  assert.match(monitor, /chmod 600/);
  assert.match(monitor, /STOR24_ALERT_HOSTINGER_SMTP_PASSWORD/);
  assert.doesNotMatch(monitor, /SENDGRID_API_KEY|STOR24_ALERT_EMAIL_FROM/);
  assert.match(monitor, /npm ci --omit=dev --ignore-scripts/);
});

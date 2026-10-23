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
  assert.match(monitor, /node scripts\/check-production-readiness.mjs/);
  const probe = readFileSync(new URL("../scripts/public-readiness.sh", import.meta.url), "utf8");
  assert.match(probe, /status !== "ok"/);
  assert.match(probe, /database !== "ok"/);
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


test("both SSH-bearing monitor jobs use the independent macOS network", () => {
  const workflow = monitor.replaceAll("\r\n", "\n");
  for (const name of ["backup", "alerts"]) {
    const job = workflow.split(`  ${name}:\n`)[1]?.split(/\n  [a-z][a-z-]*:\n/)[0];
    assert.ok(job, `${name} job is required`);
    assert.match(job, /runs-on: macos-latest/);
    assert.match(job, /StrictHostKeyChecking=yes/);
    assert.match(job, /ConnectionAttempts=3/);
  }
  assert.match(workflow, /readiness-primary:\n    runs-on: ubuntu-latest/);
});

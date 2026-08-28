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

test("scheduled production monitoring verifies application and database health", () => {
  assert.match(monitor, /cron: "\*\/10 \* \* \* \*"/);
  assert.match(monitor, /status !== "ok"/);
  assert.match(monitor, /database !== "ok"/);
});

test("the container healthcheck consumes the readiness endpoint", () => {
  assert.match(compose, /healthcheck:[\s\S]*\/api\/health/);
});

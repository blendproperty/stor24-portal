import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const advisory = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const exceptionExpires = Date.parse("2026-12-18T00:00:00Z");

function check(full, production, now = Date.now()) {
  const productionCount = production.metadata?.vulnerabilities?.total;
  if (productionCount !== 0 || Object.keys(production.vulnerabilities ?? {}).length !== 0) {
    throw new Error("Production dependencies have audit findings");
  }

  const findings = full.vulnerabilities ?? {};
  const names = Object.keys(findings);
  if (names.length !== full.metadata?.vulnerabilities?.total) {
    throw new Error("Incomplete npm audit report");
  }
  if (names.length === 0) return "No dependency advisories";
  if (now >= exceptionExpires) throw new Error("Picomatch exception expired on 2026-12-18");

  function verify(name, path = new Set()) {
    const finding = findings[name];
    if (!finding || !Array.isArray(finding.via) || finding.via.length === 0 || path.has(name)) {
      throw new Error(`Unexpected audit dependency path: ${name}`);
    }
    const next = new Set(path).add(name);
    for (const cause of finding.via) {
      if (typeof cause === "string") verify(cause, next);
      else if (cause?.name !== "picomatch" || cause.url !== advisory) {
        throw new Error(`Unapproved audit advisory in ${name}`);
      }
    }
  }
  for (const name of names) verify(name);
  return `Time-limited development-only exception: ${advisory} (${names.length} affected dependency paths)`;
}

function audit(omitDev) {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/c", `npm audit ${omitDev ? "--omit=dev " : ""}--json`]
    : ["audit", ...(omitDev ? ["--omit=dev"] : []), "--json"];
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error(`npm audit failed: ${result.error?.message ?? result.stderr}`);
  const report = JSON.parse(result.stdout);
  if (report.error || typeof report.metadata?.vulnerabilities?.total !== "number" || !report.vulnerabilities) {
    throw new Error("npm audit returned an incomplete report");
  }
  if (result.status !== Number(report.metadata.vulnerabilities.total > 0)) {
    throw new Error("npm audit exit code disagrees with its report");
  }
  return report;
}

if (process.argv.includes("--self-test")) {
  const clean = { metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} };
  const affected = { metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
    picomatch: { via: [{ name: "picomatch", url: advisory }] },
    micromatch: { via: ["picomatch"] },
  } };
  assert.match(check(affected, clean, exceptionExpires - 1), /development-only exception/);
  assert.throws(() => check(affected, affected, exceptionExpires - 1), /Production dependencies/);
  assert.throws(() => check(affected, clean, exceptionExpires), /expired/);
  assert.throws(() => check({ ...affected, vulnerabilities: { ...affected.vulnerabilities, picomatch: { via: [{ name: "picomatch", url: "https://github.com/advisories/OTHER" }] } } }, clean, exceptionExpires - 1), /Unapproved/);
  console.log("Dependency audit exception self-test passed");
} else {
  try {
    console.log(check(audit(false), audit(true)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

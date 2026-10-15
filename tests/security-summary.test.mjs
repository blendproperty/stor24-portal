import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function summarise(report, format) {
  const dir = mkdtempSync(join(tmpdir(), "stor24-scanner-summary-"));
  try {
    const file = join(dir, "report.json");
    writeFileSync(file, JSON.stringify(report));
    return spawnSync(process.execPath, ["scripts/security-summary.mjs", file, format], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("history diagnostics retain exact source identity and exclude matched values and personal metadata", () => {
  const commit = "a".repeat(40);
  const fingerprint = `${commit}:tests/synthetic.test.ts:generic-api-key:7`;
  const result = summarise([{ Commit: commit, Fingerprint: fingerprint, File: "tests/synthetic.test.ts", RuleID: "generic-api-key", StartLine: 7,
    Secret: "private-value-must-not-appear", Match: "matched-line-must-not-appear", Message: "commit-message-must-not-appear", Author: "author-must-not-appear", Email: "email-must-not-appear" }], "gitleaks");
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).findings, [{ rule: "generic-api-key", path: "tests/synthetic.test.ts", line: 7, commit, fingerprint }]);
  assert.doesNotMatch(result.stdout, /must-not-appear|Secret|Match|Message|Author|Email/);
});

test("unexpected identity fields cannot publish arbitrary scanner-report text", () => {
  const result = summarise([{ Commit: "untrusted-identity-must-not-appear", Fingerprint: "unexpected-value-must-not-appear", File: "tests/example.ts", RuleID: "generic-api-key", StartLine: 2 },
    { Commit: "b".repeat(40), Fingerprint: "unexpected-value-must-not-appear", File: "tests/example.ts", RuleID: "generic-api-key", StartLine: 3 }], "gitleaks");
  assert.equal(result.status, 0);
  const findings = JSON.parse(result.stdout).findings;
  assert.equal(findings[0].commit, undefined);
  assert.equal(findings[1].commit, "b".repeat(40));
  assert.ok(findings.every(f => f.fingerprint === undefined));
  assert.doesNotMatch(result.stdout, /must-not-appear/);
});

test("Semgrep diagnostics retain failure status without publishing matches or history identity", () => {
  const result = summarise({ results: [{ check_id: "test-rule", path: "src/example.ts", start: { line: 4 }, extra: { lines: "matched-source-must-not-appear" }, Commit: "c".repeat(40) }],
    errors: [{ type: ["PartialParsing"], code: 3, path: "src/example.ts", message: "source-error-must-not-appear" }] }, "semgrep");
  assert.equal(result.status, 2);
  const [summary, errors] = result.stdout.trim().split("\n").map(JSON.parse);
  assert.deepEqual(summary.findings, [{ rule: "test-rule", path: "src/example.ts", line: 4 }]);
  assert.equal(summary.errors, 1);
  assert.equal(errors[0].type, "PartialParsing");
  assert.doesNotMatch(result.stdout, /must-not-appear|commit|fingerprint/);
});

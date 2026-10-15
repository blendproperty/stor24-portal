import { readFileSync } from "node:fs";
const [path, format] = process.argv.slice(2);
const report = JSON.parse(readFileSync(path, "utf8"));
const findings = format === "gitleaks" ? report : report.results;
if (!Array.isArray(findings)) throw new Error("Scanner did not return a valid report.");
const historyIdentity = finding => {
  const commit = typeof finding.Commit === "string" && /^[a-f0-9]{40}$/i.test(finding.Commit) ? finding.Commit : undefined;
  const expected = commit && `${commit}:${finding.File}:${finding.RuleID}:${finding.StartLine}`;
  return { commit, fingerprint: expected && finding.Fingerprint === expected ? expected : undefined };
};
console.log(JSON.stringify({ scanner: format, findings: findings.map(f => ({
  rule: f.RuleID ?? f.check_id, path: f.File ?? f.path, line: f.StartLine ?? f.start?.line,
  ...(format === "gitleaks" ? historyIdentity(f) : {}),
})), errors: format === "semgrep" ? (report.errors?.length ?? 0) : 0 }));
if (format === "semgrep" && report.errors?.length) { console.log(JSON.stringify(report.errors.map(e => ({type:Array.isArray(e.type) ? e.type[0] : e.type, code:e.code, path:e.path ?? e.spans?.[0]?.file ?? null, line:e.spans?.[0]?.start?.line ?? null})))); process.exit(2); }

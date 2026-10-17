import assert from "node:assert/strict";
import test from "node:test";
import { operationsStartGroups } from "../src/lib/operations-start-guide";

test("start guide has no guessed destinations when no dashboard workflows are available", () => {
  assert.deepEqual(operationsStartGroups([]), []);
  assert.deepEqual(operationsStartGroups([{ label: "Call past dues", href: "/collections" }]), []);
});
test("arrival guidance retains the same scoped date-window destination and keeps key checks separate", () => {
  const href = "/operations/arrivals?from=2026-10-17&to=2026-10-23";
  const groups = operationsStartGroups([{ label: "Expected arrivals", href }]);
  assert.equal(groups.length, 1); assert.equal(groups[0].id, "cover");
  assert.equal(groups[0].jobs.length, 1); assert.equal(groups[0].jobs[0].href, href);
  assert.match(groups[0].jobs[0].steps[2], /Key handover still requires all move-in checks/);
});
test("guide does not expose absent payment, transfer or move-in jobs; existing task navigation remains", () => {
  const groups = operationsStartGroups([{ label: "Reminders", href: "/operations#operations-tasks" }, { label: "Customer follow-ups", href: "/operations/followups" }]);
  const jobs = groups.flatMap(group => group.jobs);
  assert.deepEqual(jobs.map(job => job.id), ["followup", "tasks", "close"]);
  assert.equal(jobs.find(job => job.id === "tasks")!.href, "/operations#operations-tasks");
  assert.match(jobs.find(job => job.id === "close")!.steps[2], /If authorised/);
});

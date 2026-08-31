import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/v1/accounts/route.ts", "utf8");
const workspace = readFileSync("src/components/accounts-workspace.tsx", "utf8");

test("accounts include the pending move-in occupancy with its unit and rate", () => {
  assert.match(
    route,
    /occupancies:\s*\{[\s\S]*?status:\s*\{\s*in:\s*\["PENDING",\s*"ACTIVE",\s*"NOTICE_GIVEN"\]/,
  );
  assert.match(route, /occupancies:[\s\S]*?orderBy:\s*\{\s*startDate:\s*"desc"\s*\}[\s\S]*?take:\s*1/);
});

test("accounts label a pending occupancy without claiming that access is active", () => {
  assert.match(workspace, /status:\s*string/);
  assert.match(workspace, /status === "PENDING"\) return "Pending lease signature"/);
  assert.match(workspace, /occupancyLabel\(selected\.tenancy\?\.occupancies\[0\]\?\.status\)/);
});

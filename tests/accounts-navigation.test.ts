import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/accounts-workspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
test("account selection opens details and supports a return to the selected row", () => {
  assert.match(source, /setSelectedId\(account.id\);\s+setDetailOpen\(true\)/);
  assert.match(source, /aria-controls="selected-account-details"/);
  assert.match(source, /Back to accounts/);
  assert.match(source, /account-list-row.active/);
  assert.match(css, /\.accounts-layout\.account-open \.accounts-list \{ display: none; \}/);
  assert.match(css, /\.accounts-layout:not\(\.account-open\) \.account-detail \{ display: none; \}/);
});
test("loading accounts is not reported as zero or an empty list", () => {
  assert.match(source, /data \? value : "—"/);
  assert.match(source, /Loading accounts…/);
});

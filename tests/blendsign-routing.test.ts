import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { blendSignTemplateKey } from "../src/lib/blendsign-client.ts";

const source = fs.readFileSync("src/lib/blendsign-client.ts", "utf8");

test("debit orders use the mandate template", () => {
  assert.equal(blendSignTemplateKey("DEBIT_ORDER"), "stor24-unit-lease-debit-order");
});

test("non-debit payment methods use the standard template", () => {
  assert.equal(blendSignTemplateKey("CARD"), "stor24-unit-lease");
  assert.equal(blendSignTemplateKey("EFT"), "stor24-unit-lease");
  assert.equal(blendSignTemplateKey("OTHER"), "stor24-unit-lease");
});

test("debit-order merge keys match the active BlendSign template", () => {
  assert.match(source, /data\["debit\.commencementDate"\]/);
  assert.match(source, /data\["debit\.amount"\]/);
  assert.doesNotMatch(source, /debitOrder\.commencementDate/);
  assert.doesNotMatch(source, /debitOrder\.amount/);
});

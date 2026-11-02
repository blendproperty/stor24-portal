import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import source from "../docs/legal/2026-11-02/confirmed-word-terms.json";
import { STORAGE_TERMS, STORAGE_TERMS_SOURCE, storageTermsText } from "../src/lib/storage-terms-2026-11-02";
import { STORAGE_TERMS_VERSION as octoberVersion, renderReviewLeaseDocument as renderOctoberEdition } from "../src/lib/storage-terms-2026-10-20";
import { renderStorageTermsEdition } from "../src/lib/storage-terms";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

test("confirmed Word source retains all 22 clauses without wording changes", () => {
  assert.equal(STORAGE_TERMS_SOURCE.sha256, "055fb89975ca39c2a77574486494be44a1ef2811cc8aef09acb44e80f80e89da");
  const clauses = source.sections.filter(section => /^\d+ /.test(section.title));
  assert.deepEqual(clauses.map(section => Number(section.title.split(" ")[0])), Array.from({ length: 22 }, (_, index) => index + 1));
  assert.equal(sha256(JSON.stringify(clauses)), "80553a2e53a47280cd368a0cac1e80f60bd4defc52403045c81a1b7ab6d27aa0");
  assert.equal(source.clausesSha256, sha256(JSON.stringify(clauses)));
});

test("customer edition omits internal templates and requires no deposit", () => {
  const content = storageTermsText();
  assert.equal(STORAGE_TERMS.length, 33);
  assert.match(content, /No security deposit is required/);
  assert.doesNotMatch(content, /\[confirm|\[complete|________________|review draft|legal review|Faeez|Liezl|StoreSmart|deposit equal to one month|deposit or advance-payment|Initial rent and deposit/i);
  assert.match(content, /annual rate of 24%/);
  assert.match(content, /no later than the 15th/);
  assert.match(content, /Separate debit order authorisation/);
  assert.ok(STORAGE_TERMS.find(s => s.title.startsWith("1."))?.refundRelevant);
  for (const original of source.sections.filter(s => /^\d+ /.test(s.title))) {
    const number = Number(original.title.split(" ")[0]);
    if ([10, 11, 20].includes(number)) continue;
    assert.equal(STORAGE_TERMS.find(s => s.title.startsWith(`${number}. `))?.body, original.body);
  }
});

test("the 20 October renderer is byte-preserved and still reproduces its accepted edition", async () => {
  const historicalSource = (await readFile("src/lib/storage-terms-2026-10-20.ts", "utf8")).replace(/\r\n/g, "\n");
  assert.equal(sha256(historicalSource), "51f570aae48491cd8d50d773e4f0bc5baf73bd96556be790b5d3838b54abbf1d");
  assert.equal(octoberVersion, "storage-terms-2026-10-20");
  const context = { facilityName: "Synthetic Midpoint", unitNumber: "TEST", customerName: "Test Customer", monthlyRate: 1250,
    startDate: new Date("2026-11-16T00:00:00Z"), paymentMethod: "EFT" as const,
    initialRent: { lines: [{ period: "November", amount: 625 }, { period: "December", amount: 1250 }], total: 1875 } };
  const historical = renderOctoberEdition(context);
  assert.equal(renderStorageTermsEdition(context, octoberVersion), historical);
  assert.notEqual(sha256(historical), sha256(renderOctoberEdition({ ...context, monthlyRate: 1300 })));
});

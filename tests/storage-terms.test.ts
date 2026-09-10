import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { STORAGE_TERMS, STORAGE_TERMS_VERSION, buildReviewLeaseClauses, renderReviewLeaseDocument } from "../src/lib/storage-terms";
import { renderLeaseDocument, LEASE_VERSION } from "../src/lib/lease-agreement-content";
import { renderSignedLeasePdf } from "../src/lib/public-lease-pdf";
import { db } from "../src/lib/db";
import { completePublicReservationLease, preparePublicReservationLease } from "../src/lib/public-lease-workflow";
import { LEASE_CLAUSE_KEYS } from "../src/lib/lease-agreement-content";

const context = { facilityName: "Store 1 - Midpoint", unitNumber: "TEST-001", unitTypeName: "6 square metres", customerName: "Review Customer", monthlyRate: 1550, startDate: new Date("2026-09-30T00:00:00Z"), paymentMethod: "DEBIT_ORDER" as const, storagePackage: { name: "Moving essentials", priceZar: 649, contents: "5 x Small Moving Box, 5 x Medium Moving Box, 1 x Packing Tape, 1 x Permanent Marker" } };

test("full review edition includes schedule, every terms section and all eight summaries", () => {
  const content = renderReviewLeaseDocument(context);
  assert.equal(STORAGE_TERMS.length, 20);
  assert.equal(buildReviewLeaseClauses(context).length, 8);
  for (const section of STORAGE_TERMS) { assert.ok(content.includes(section.title)); assert.ok(content.includes(section.body)); }
  for (const expected of [STORAGE_TERMS_VERSION, "Review Customer", "TEST-001", "Moving essentials", "5 x Small Moving Box", "14 calendar days", "no additional charge authorised"]) assert.ok(content.includes(expected), expected);
  assert.doesNotMatch(content, /excluding applicable tax|terminate immediately/);
});

test("historical renderer remains unchanged and commercial changes alter the fingerprint", () => {
  assert.match(renderLeaseDocument(context), new RegExp(LEASE_VERSION));
  assert.notEqual(renderLeaseDocument(context), renderReviewLeaseDocument(context));
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const original = hash(renderReviewLeaseDocument(context));
  assert.notEqual(original, hash(renderReviewLeaseDocument({ ...context, monthlyRate: 1600 })));
  assert.notEqual(original, hash(renderReviewLeaseDocument({ ...context, storagePackage: null })));
  assert.notEqual(original, hash(renderReviewLeaseDocument({ ...context, paymentMethod: "CARD" })));
});

test("complete review PDF is multipage with signature record and page furniture", async () => {
  const bytes = await renderSignedLeasePdf({ content: renderReviewLeaseDocument(context), reference: "ST24-LEGAL-REVIEW", paymentMethod: context.paymentMethod, signerName: "SAMPLE ONLY - Review Customer", signedAt: new Date("2026-09-10T10:00:00Z"), sha256: "a".repeat(64) });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 5);
  assert.ok(pdf.getPageCount() <= 12);
  assert.equal(pdf.getTitle(), "Stor24 signed agreement ST24-LEGAL-REVIEW");
});

test("full terms acceptance is server enforced against the displayed fingerprint", async () => {
  const source = await readFile("src/lib/public-lease-workflow.ts", "utf8");
  assert.match(source, /input\.termsAccepted !== true/);
  assert.match(source, /input\.acceptedSha256 !== lease\.sha256/);
  assert.match(source, /full_terms:/);
  assert.match(source, /legacySigned \? renderLeaseDocument\(context\)/);
});

test("server refuses missing or stale terms consent and saves exact accepted edition", async () => {
  const original = Reflect.get(db, "$transaction");
  let saved: unknown; let audits = 0;
  const tx = { publicReservationLease: {
    findUnique: async () => ({ id: "sample", reservationId: "sample", status: "READY", version: STORAGE_TERMS_VERSION, content: renderReviewLeaseDocument(context), sha256: "a".repeat(64), paymentMethod: "DEBIT_ORDER", expiresAt: new Date(Date.now() + 60000), reservation: { status: "ACTIVE", publicReference: "SAMPLE", customer: { organisationId: "sample" } } }),
    updateMany: async (args: unknown) => { saved = args; return { count: 1 }; },
  }, auditEvent: { create: async () => { audits++; } } };
  Reflect.set(db, "$transaction", async (callback: (value: typeof tx) => unknown) => callback(tx));
  const input = { signerName: "Test Customer", initials: LEASE_CLAUSE_KEYS, signerIp: null, signerUserAgent: null };
  try {
    await assert.rejects(completePublicReservationLease("sample", input), /VALIDATION_ERROR/);
    await assert.rejects(completePublicReservationLease("sample", { ...input, termsAccepted: true, acceptedSha256: "b".repeat(64) }), /VALIDATION_ERROR/);
    assert.equal(saved, undefined); assert.equal(audits, 0);
    assert.equal((await completePublicReservationLease("sample", { ...input, termsAccepted: true, acceptedSha256: "a".repeat(64) })).status, "SIGNED");
    assert.match(JSON.stringify(saved), new RegExp(`full_terms:${STORAGE_TERMS_VERSION}`));
    assert.equal(audits, 1);
  } finally { Reflect.set(db, "$transaction", original); }
});

test("historical signed reservation can resume but changed commercial terms cannot", async () => {
  const original = Reflect.get(db.reservation, "findUnique");
  const legacyContext = { ...context, storagePackage: null };
  const reservation = { status: "ACTIVE", journey: "RENTAL", contactVerifiedAt: new Date(), intendedMoveIn: context.startDate, quotedRate: context.monthlyRate,
    customer: { companyName: context.customerName, emailVerifiedAt: new Date() }, facility: { name: context.facilityName }, unit: { number: context.unitNumber, unitType: { name: context.unitTypeName } },
    publicLease: { status: "SIGNED", version: LEASE_VERSION, signingToken: "old-token", sha256: createHash("sha256").update(renderLeaseDocument(legacyContext)).digest("hex") } };
  Reflect.set(db.reservation, "findUnique", async () => reservation);
  try {
    assert.equal((await preparePublicReservationLease("SAMPLE", "DEBIT_ORDER")).ok, true);
    reservation.quotedRate = 1600;
    assert.deepEqual(await preparePublicReservationLease("SAMPLE", "DEBIT_ORDER"), { ok: false, code: "SIGNED_LEASE_CHANGED" });
  } finally { Reflect.set(db.reservation, "findUnique", original); }
});

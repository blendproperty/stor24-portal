import test from "node:test";
import assert from "node:assert/strict";
import { formTemplate,operationalFormTemplates,initialFormValues,validateFormValues,formChangeSchema } from "../src/lib/operational-form-policy";

test("all source forms have exact fields, source attribution and approval holds",() => {
  assert.equal(Object.keys(operationalFormTemplates).length,11);
  for (const kind of ["ATTENDANCE","VISITOR","DEBIT_AUTHORITY"] as const) { assert.equal(formTemplate(kind).captureHeld,true);assert.ok(formTemplate(kind).hold); }
  for (const kind of ["ADJUDICATION","QUOTATION","LEGAL_1","LEGAL_2","LEGAL_3","EMERGENCY"] as const) assert.ok(formTemplate(kind).hold);
  assert.equal(formTemplate("ATTENDANCE").fields.some(f => f.key === "timeOut"),true);
  assert.equal(formTemplate("VISITOR").fields.some(f => f.key === "timeOut"),false);
  assert.equal(formTemplate("MAINTENANCE").fields.some(f => f.key === "response"),true);
  assert.match(initialFormValues("LEGAL_1").wording,/DRAFT FOR LEGAL REVIEW/);
  assert.match(initialFormValues("QUOTATION").terms,/Approved/);
  assert.match(initialFormValues("EMERGENCY").instructions,/DRAFT FOR SITE SAFETY REVIEW/);
  assert.deepEqual(initialFormValues("CERTIFICATE"),{});
});
test("drafts allow blank fields but reject unknown, malformed dates, time, money and reversed dates",() => {
  validateFormValues("MAINTENANCE",{});
  assert.throws(() => validateFormValues("MAINTENANCE",{},true),/INCOMPLETE/);
  const invalid: Record<string,string>[] = [{ unknown:"test" },{ discovered:"2026-02-30" },{ discovered:"2026-10-30",resolved:"2026-10-29" }];
  for (const values of invalid) assert.throws(() => validateFormValues("MAINTENANCE",values),/INVALID|ORDER/);
  for (const cost of ["-1","1e4","1,000","Infinity","0.001"]) assert.throws(() => validateFormValues("ADJUDICATION",{ cost }),/INVALID/);
  validateFormValues("ADJUDICATION",{ cost:"6663.10" });
  assert.throws(() => validateFormValues("ATTENDANCE",{ timeIn:"25:00" }),/INVALID/);
  assert.throws(() => validateFormValues("ATTENDANCE",{ timeIn:"12:00",timeOut:"11:00" }),/ORDER/);
  assert.equal(formChangeSchema.safeParse({ id:"cm00000000000000000000001",expectedUpdatedAt:new Date().toISOString(),action:"PUBLISH",note:"Approved" }).success,false);
});

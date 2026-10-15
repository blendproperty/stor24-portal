import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifyProjectContext} from "../scripts/verify-project-context.mjs";
const canonical=readFileSync("PROJECT_CONTEXT.md","utf8");
test("the complete canonical document survives UTF-8 BOM and Windows newline normalization",()=>{
  const baseline=verifyProjectContext(canonical,canonical);
  const windows=verifyProjectContext("\uFEFF"+canonical.replaceAll("\r\n","\n").replaceAll("\n","\r\n"),canonical);
  assert.deepEqual(windows,baseline);assert.ok(baseline.bytes>1000000);
});
test("empty API content followed by appended release paragraphs cannot pass canonical preservation",()=>{
  for(const content of ["","\n- **Cohort retarget:** new release entry.\n\n- **Actual release:** recent verification only.\n"]){assert.throws(()=>verifyProjectContext(content,canonical),/truncated|canonical identity/);}
});
test("a surviving title cannot disguise substantial loss of the base history",()=>{
  assert.throws(()=>verifyProjectContext(canonical,canonical+canonical),/lost more than/);
});

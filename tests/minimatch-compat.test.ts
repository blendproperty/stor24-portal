import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
const require=createRequire(import.meta.url);
const match=require("minimatch");

test("patched matcher retains callable glob consumers and modern named/class exports",()=>{
  assert.equal(match("folder/report.xlsx","**/*.{xlsx,pdf}"),true);
  assert.equal(match("folder/private.txt","**/*.{xlsx,pdf}"),false);
  assert.equal(match(".env","*"),false);
  assert.equal(match.defaults({dot:true})(".env","*"),true);
  assert.deepEqual(["one.ts","two.txt"].filter(match.filter("*.ts")),["one.ts"]);
  assert.deepEqual(match.match(["one.ts","two.txt"],"*.ts"),["one.ts"]);
  assert.deepEqual(match.braceExpand("a{1,2}"),["a1","a2"]);
  assert.ok(match.makeRe("*.ts").test("one.ts"));
  assert.equal(new match.Minimatch("**/*.jpeg").match("evidence/photo.jpeg"),true);
  assert.equal(match.minimatch("report.pdf","*.pdf"),true);
  assert.ok(match.GLOBSTAR);
  assert.deepEqual(require("glob").sync("tests/minimatch-*.test.ts",{cwd:process.cwd(),nodir:true}),["tests/minimatch-compat.test.ts"]);
});

test("upstream globparts amplification regression stays bounded in a child process",()=>{
  const child=spawnSync(process.execPath,["--max-old-space-size=128","-e",`const assert=require('node:assert/strict');const {Minimatch}=require('minimatch');const m=new Minimatch('a/'+('**/../b/').repeat(24)+'c',{optimizationLevel:2,braceExpandMax:16});assert.ok(m.globParts.length<=16);`],{cwd:process.cwd(),timeout:5000,encoding:"utf8"});
  assert.equal(child.error,undefined);
  assert.equal(child.status,0,child.stderr);
});

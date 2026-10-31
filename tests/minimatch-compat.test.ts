import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
const load = createRequire(import.meta.url);
test("legacy lint consumers retain callable/default APIs backed by patched upstream", () => {
 for (const name of ["eslint-plugin-import", "eslint-plugin-react", "eslint-plugin-jsx-a11y", "@eslint/config-array"]) {
  const caller = createRequire(load.resolve(name));
  const match = caller("minimatch");
  assert.equal(caller("minimatch/package.json").version, "10.2.6-stor24.1");
  assert.equal(match("src/page.tsx", "**/*.{ts,tsx}"), true);
  assert.equal(match("src/page.js", "**/*.tsx"), false);
  assert.equal(new match.Minimatch("**/*.tsx").match("src/page.tsx"), true);
  assert.equal(match.makeRe("*.js").test("page.js"), true);
  assert.deepEqual(match.match(["a.ts", "b.js"], "*.ts"), ["a.ts"]);
  assert.equal(match.defaults({nocase:true})("PAGE.TSX", "*.tsx"), true);
  assert.equal(match.Minimatch, createRequire(caller.resolve("minimatch"))("./upstream/index.js").Minimatch);
 }
});
test("legacy glob still enumerates actual repository paths", () => {
 assert.deepEqual(load("glob").sync("tests/minimatch-*.test.ts", {cwd:process.cwd(),nodir:true}), ["tests/minimatch-compat.test.ts"]);
});
test("modern TypeScript parser retains the named API on the patched core", () => {
 const caller = createRequire(load.resolve("@typescript-eslint/typescript-estree"));
 const match = caller("minimatch");
 assert.equal(caller("minimatch/package.json").version, "10.2.6-stor24.1");
 assert.equal(match.minimatch("src/page.ts", "**/*.ts"), true);
});

test("upstream security limits bound pattern amplification and quadratic dedupe", () => {
 const modulePath = createRequire(load.resolve("@eslint/config-array")).resolve("minimatch");
 execFileSync(process.execPath, ["-e", `
  const assert=require('node:assert/strict'), {Minimatch}=require(${JSON.stringify(modulePath)});
  const p=Array(30).fill('**/../a/b').join('/');
  assert.equal(new Minimatch(p,{optimizationLevel:2,braceExpandMax:64}).set.length,64);
  const large=new Minimatch('{x,*}/{0..999}',{optimizationLevel:2});
  assert.equal(large.set.length,2000);assert.equal(large.match('y/999'),true);
 `], {timeout:5000,stdio:"pipe"});
});

import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const load = createRequire(import.meta.url);
test("legacy lint consumers retain callable/default APIs backed by patched upstream", () => {
 for (const name of ["eslint-plugin-import", "eslint-plugin-react", "eslint-plugin-jsx-a11y", "@eslint/config-array"]) {
  const caller = createRequire(load.resolve(name));
  const match = caller("minimatch");
  assert.equal(caller("minimatch/package.json").version, "11.0.3-stor24.1");
  assert.equal(match("src/page.tsx", "**/*.{ts,tsx}"), true);
  assert.equal(match("src/page.js", "**/*.tsx"), false);
  assert.equal(new match.Minimatch("**/*.tsx").match("src/page.tsx"), true);
  assert.equal(match.makeRe("*.js").test("page.js"), true);
  assert.deepEqual(match.match(["a.ts", "b.js"], "*.ts"), ["a.ts"]);
  assert.equal(match.defaults({nocase:true})("PAGE.TSX", "*.tsx"), true);
  assert.equal(createRequire(caller.resolve("minimatch"))("minimatch-core/package.json").version, "11.0.3");
 }
});
test("modern TypeScript parser retains the named API on the patched core", () => {
 const caller = createRequire(load.resolve("@typescript-eslint/typescript-estree"));
 const match = caller("minimatch");
 assert.equal(caller("minimatch/package.json").version, "11.0.3-stor24.1");
 assert.equal(match.minimatch("src/page.ts", "**/*.ts"), true);
});

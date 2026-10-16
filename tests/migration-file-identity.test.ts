import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, readdirSync, rmdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const records: Record<string, string> = {
  facilities: "a,Alpha,A,Africa/Johannesburg",
  unit_types: "ta,a,Small,2,2,4", units: "ua,a,ta,1,AVAILABLE,100",
  customers: "c,Synthetic,Customer,,,", tenancies: "t,a,c,ua,ACTIVE,2026-09-01,,100",
  reservations: "r,a,c,ua,ACTIVE,100,2026-10-01,2026-10-01",
};

async function runIdentityFixture(mode: "distinct" | "same" | "other-device") {
  const root = realpathSync(tmpdir()), directory = mkdtempSync(join(root, "stor24-identity-test-"));
  assert.ok(realpathSync(directory).startsWith(root + sep)); assert.ok(basename(directory).startsWith("stor24-identity-test-"));
  const sourceId = BigInt("9007199254740992"), one = BigInt(1), outputId = mode === "distinct" ? sourceId + one : sourceId;
  assert.equal(Number(sourceId), Number(sourceId + one), "The fixture must exercise a real Number precision collision.");
  try {
    const sources = new Map<string, Buffer>();
    for (const [name, row] of Object.entries(records)) {
      const header = readFileSync(resolve("migration/templates", `${name}.csv`), "utf8").trim(), file = join(directory, `${name}.csv`);
      writeFileSync(file, `${header}\n${row}\n`); sources.set(file, readFileSync(file));
    }
    const output = join(directory, "result.json"), prior = "stale report".repeat(1000); writeFileSync(output, prior);
    // Run the actual CLI and real file IO. Only stat identity values are varied
    // across the documented number/bigint API representations.
    const bundle = await build({ entryPoints: ["scripts/validate-migration-export.mjs"], bundle: true, write: false, platform: "node", format: "esm", target: "node22", plugins: [{ name: "large-native-file-identities", setup(builder) {
      builder.onResolve({ filter: /^node:fs\/promises$/ }, args => args.namespace === "identity-fixture" ? { path: args.path, external: true } : { path: args.path, namespace: "identity-fixture" });
      builder.onLoad({ filter: /.*/, namespace: "identity-fixture" }, () => ({ contents: `
        import * as actual from 'node:fs/promises';import {basename} from 'node:path';
        const sourceId=${sourceId}n,outputId=${outputId}n,outputDevice=${mode === "other-device" ? "2n" : "1n"};
        export const readFile=actual.readFile;
        export async function stat(file,options){const value=await actual.stat(file,options);return basename(file)==='customers.csv'?{...value,dev:options?.bigint?1n:1,ino:options?.bigint?sourceId:Number(sourceId)}:value;}
        export async function open(...args){const handle=await actual.open(...args),original=handle.stat.bind(handle);handle.stat=async options=>{const value=await original(options);return {...value,dev:options?.bigint?outputDevice:Number(outputDevice),ino:options?.bigint?outputId:Number(outputId)}};return handle;}
      ` }));
    } }] });
    const executable = join(directory, "validator.mjs"); writeFileSync(executable, bundle.outputFiles[0].text);
    const child = spawnSync(process.execPath, [executable, directory, output], { encoding: "utf8", timeout: 15000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    for (const [file, bytes] of sources) assert.deepEqual(readFileSync(file), bytes, "Original migration inputs must remain unchanged.");
    if (mode === "same") {
      assert.equal(child.status, 1); assert.match(child.stderr, /Report output cannot overwrite a source file/); assert.equal(readFileSync(output, "utf8"), prior);
    } else {
      assert.equal(child.status, 0, child.stderr); const report = JSON.parse(readFileSync(output, "utf8")); assert.equal(report.valid, true); assert.equal(report.reconciliation.ready, true);
    }
  } finally {
    // Every child is a fixed-name fixture created above. No recursive cleanup.
    for (const name of readdirSync(directory)) { const file = resolve(directory, name); assert.equal(dirname(file), resolve(directory)); unlinkSync(file); }
    rmdirSync(directory);
  }
}

test("migration CLI distinguishes large file IDs while preserving same-file and device controls", async t => {
  await t.test("different 64-bit identities that round to the same Number can produce a report", () => runIdentityFixture("distinct"));
  await t.test("the same large native identity remains blocked before output truncation", () => runIdentityFixture("same"));
  await t.test("equal inode values on different devices remain distinct files", () => runIdentityFixture("other-device"));
});

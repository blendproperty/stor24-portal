import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("phone notice API rejects anonymous, cross-origin, oversized and unreviewed commands before mutation", async () => {
  let signedIn = false, origin = true, reads = 0, writes = 0, crash = false;
  const bundle = await build({ entryPoints: ["src/app/api/v1/collections/phone-notices/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "phone-api-fixture", setup(b) {
    b.onResolve({ filter: /integrations\/twilio-provider$/ }, () => ({ path: "phone-normalizer", namespace: "phone-normalizer" }));
    b.onLoad({ filter: /.*/, namespace: "phone-normalizer" }, () => ({ contents: `export const normalizeTwilioRecipient=()=>{throw Error('Unexpected template rendering in API guard test')};` }));
    b.onResolve({ filter: /^@\/lib\/email$/ }, () => ({ path: "phone-email", namespace: "phone-email" }));
    b.onLoad({ filter: /.*/, namespace: "phone-email" }, () => ({ contents: `export const escapeEmailHtml=()=>{throw Error('Unexpected HTML rendering in API guard test')};` }));
    b.onResolve({ filter: /^@\/lib\/(scope|request-security|collection-phone-service)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/scope") ? `export const requirePermissionScope=async p=>{if(!['collections.view','collections.manage'].includes(p))throw Error('BAD_PERMISSION');if(!__signedIn())throw Error('UNAUTHENTICATED');return {userId:'fixture',organisationId:'fixture'}};` : a.path.endsWith("/request-security") ? `export const sameOrigin=()=>__origin();export const rateLimit=async()=>false;` : `export const previewPhoneNotice=async()=>{__read();return {safe:true}};export const actPhoneNotice=async()=>{__write();return {safe:true}};` }));
  } }] });
  const loaded = { exports: {} as { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> } };
  new Function("require", "module", "exports", "__signedIn", "__origin", "__read", "__write", bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, () => signedIn, () => origin, () => { reads++; if (crash) throw Error("Private recipient secret"); }, () => { writes++; });
  const url = "https://example.invalid/api/v1/collections/phone-notices", accountId = "cm00000000000000000000001", read = () => new Request(`${url}?accountId=${accountId}&channel=SMS`), post = (body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });
  assert.equal((await loaded.exports.GET(read())).status, 401); assert.equal(reads, 0);
  signedIn = true; assert.equal((await loaded.exports.GET(new Request(url))).status, 400); assert.equal(reads, 0);
  origin = false; assert.equal((await loaded.exports.POST(post({}))).status, 403); assert.equal(writes, 0);
  origin = true;
  for (const body of [{ action: "send", accountId, channel: "SMS", confirm: true }, { action: "prepare", accountId, channel: "SMS", fingerprint: "a".repeat(64), amount: 100 }]) assert.equal((await loaded.exports.POST(post(body))).status, 400);
  assert.equal((await loaded.exports.POST(new Request(url, { method: "POST", body: "x".repeat(4001) }))).status, 400); assert.equal(writes, 0);
  assert.equal((await loaded.exports.POST(post({ action: "prepare", accountId, channel: "SMS", fingerprint: "a".repeat(64) }))).status, 200); assert.equal(writes, 1);
  assert.equal((await loaded.exports.GET(read())).status, 200); assert.equal(reads, 1);
  crash = true; const result = await loaded.exports.GET(read()); assert.equal(result.status, 500); assert.doesNotMatch(await result.text(), /Private|recipient secret/); assert.match(result.headers.get("cache-control")!, /no-store/);
});

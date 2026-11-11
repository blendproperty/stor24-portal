import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("reset delivery failure keeps provider details out of logs and response", async () => {
  const sensitive = "synthetic@example.invalid reset-password/synthetic-secret";
  const fixtures: Record<string, string> = {
    "@/lib/db": `export const db={user:{findFirst:async()=>({id:'user',organisationId:'org',email:'synthetic@example.invalid',name:'Test'})},passwordResetToken:{updateMany:()=>null,create:()=>null},auditEvent:{create:()=>null},$transaction:async()=>{}}`,
    "@/lib/email": `export const emailProvider=()=>({send:async()=>{throw Error(${JSON.stringify(sensitive)})}})`,
    "@/lib/request-security": `export const sameOrigin=()=>true, requestIp=()=>'', privacyHash=()=>'', dlpRecipientHash=()=>'', rateLimit=async()=>false`,
  };
  const output = await build({ entryPoints: ["src/app/api/auth/forgot-password/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "privacy-fixtures", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|email|request-security)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: fixtures[a.path] }));
  } }] });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  const messages: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => { messages.push(args); };
  try {
    const response = await loaded.exports.POST(new Request("http://localhost/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "synthetic@example.invalid" }) }));
    assert.equal(response.status, 200);
    assert.match((await response.json()).data.message, /If an active account matches/);
    assert.deepEqual(messages, [["Password reset email delivery failed; review required."]]);
    assert.ok(!JSON.stringify(messages).includes(sensitive));
  } finally { console.error = original; }
});

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

async function fixture() {
  const state = { audits: [] as Record<string, unknown>[], failAudit: false, limited: false, sends: 0 };
  const built = await build({ stdin: { contents: 'export * from "./src/lib/dlp-transfer-service"; export {emailProvider} from "./src/lib/email"; export {TwilioSmsProvider,TwilioWhatsAppProvider} from "./src/lib/integrations/twilio-provider";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-dlp", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(db|request-security)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("/db") ? "export const db={auditEvent:{create:async({data})=>{if(__state.failAudit)throw Error('SYNTHETIC_AUDIT_OUTAGE');__state.audits.push(data);return data;}}};" : "export const dlpRecipientHash=value=>'synthetic-hash';export const rateLimit=async()=>__state.limited;" }));
  } }] });
  type Api = { guardDlpTransfer: (input: Record<string, unknown>) => Promise<Record<string,string>>; protectDlpResponse: (response: Response, context: Record<string,unknown>) => Promise<Response>; emailProvider: () => {send: (input: Record<string,unknown>)=>Promise<void>}; TwilioSmsProvider: new()=>{send:(input:Record<string,unknown>,context:Record<string,unknown>)=>Promise<{ok:boolean}>}; TwilioWhatsAppProvider:new()=>{sendTemplate:(recipient:string,sid:string,variables:Record<string,string>,context:Record<string,unknown>)=>Promise<{ok:boolean}>} };
  const loaded = { exports: {} as Api };
  new Function("require","module","exports","__state", built.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,state);
  return { state, api: loaded.exports };
}
const context = { organisationId:"synthetic-org", actorId:"synthetic-actor", resourceId:"synthetic-document", approvedRecipient:"recipient@example.invalid" };
test("outbound messages check approved recipients, credentials and split-transfer limits with safe audit metadata", async () => {
  const f=await fixture();
  const message={...context,channel:"EMAIL",classification:"confidential",recipient:"recipient@example.invalid",content:"Synthetic booking confirmation"};
  assert.equal((await f.api.guardDlpTransfer(message))["x-stor24-data-classification"],"confidential");
  for (const change of [{recipient:"wrong@example.invalid"},{content:"4111 1111 1111 1111"},{content:"-----BEGIN PRIVATE KEY-----"}]) await assert.rejects(f.api.guardDlpTransfer({...message,...change}),/DLP_TRANSFER_BLOCKED/);
  f.state.limited=true; await assert.rejects(f.api.guardDlpTransfer(message),/DLP_TRANSFER_BLOCKED/);
  assert.doesNotMatch(JSON.stringify(f.state.audits),/4111|PRIVATE KEY|recipient@example|wrong@example|Synthetic booking/);
});
test("private document releases preserve original bytes and fail closed on size or audit outages",async()=>{
  const f=await fixture(), bytes=new Uint8Array([37,80,68,70,45,49]);
  const response=await f.api.protectDlpResponse(new Response(bytes,{headers:{"content-type":"application/pdf"}}),context);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  assert.match(response.headers.get("cache-control")!,/no-store/);
  await assert.rejects(f.api.guardDlpTransfer({...context,channel:"DOWNLOAD",classification:"restricted",byteLength:20*1024*1024+1}),/DLP_TRANSFER_BLOCKED/);
  f.state.failAudit=true;
  await assert.rejects(f.api.protectDlpResponse(new Response(bytes),context),/SYNTHETIC_AUDIT_OUTAGE/);
});
test("all messaging providers stop before network access when DLP cannot authorise",async t=>{
  const f=await fixture();f.state.failAudit=true;
  t.mock.method(globalThis,"fetch",async()=>{f.state.sends++;return new Response(null,{status:202});});
  await assert.rejects(f.api.emailProvider().send({to:"recipient@example.invalid",subject:"Synthetic",text:"Synthetic",html:"Synthetic",dlp:context}),/SYNTHETIC_AUDIT_OUTAGE/);
  assert.equal((await new f.api.TwilioSmsProvider().send({recipient:"+27000000001",body:"Synthetic"},{organisationId:"synthetic-org",idempotencyKey:"synthetic"})).ok,false);
  assert.equal((await new f.api.TwilioWhatsAppProvider().sendTemplate("+27000000001","HX"+"0".repeat(32),{"1":"Synthetic"},{organisationId:"synthetic-org",idempotencyKey:"synthetic"})).ok,false);
  await assert.rejects(f.api.emailProvider().send({to:"recipient@example.invalid",subject:"Synthetic",text:"Synthetic",html:"Synthetic"}),/DLP_CONTEXT_REQUIRED/);
  assert.equal(f.state.sends,0);
});
test("private file release routes must retain a DLP boundary, with only public storage terms excluded",()=>{
  const root="src/app/api";
  const files=readdirSync(root,{recursive:true}).map(String).filter(path=>path.endsWith("route.ts"));
  let covered=0;
  for(const file of files){
    const source=readFileSync(`${root}/${file}`,"utf8");
    if(!/content-disposition|Content-Disposition|tenantPdf\(/.test(source))continue;
    if(file.replaceAll("\\","/")==="public/v1/storage-terms/pdf/route.ts")continue;
    if(file.replaceAll("\\","/")==="v1/move-in-training/route.ts") { assert.match(source,/trainingSample\(/); continue; }
    assert.match(source,/protectDlpResponse|guardDlpTransfer|guardReportExport|hostedMandatePdf/,`Unprotected file release: ${file}`);covered++;
  }
  assert.ok(covered>=12);
});

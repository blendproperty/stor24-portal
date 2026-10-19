import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('training HTTP boundary requires current scope, rejects live decisions and bounds input', async () => {
  const fixture = { calls: [], denied: null };
  globalThis.__receiptTrainingApi = fixture;
  const built = await build({ entryPoints: ['src/app/api/v1/training/receipt-corrections/route.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'training-http', setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|receipt-reallocation-access|receipt-correction-training-service)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path.endsWith('/db') ? 'export const db={};' : a.path.endsWith('access')
      ? 'const f=globalThis.__receiptTrainingApi;export const receiptCorrectionScope=async(action="view")=>{f.calls.push(action);if(f.denied===action)throw Error("FORBIDDEN");if(f.denied==="anonymous")throw Error("UNAUTHENTICATED");return {userId:"user",organisationId:"org",facilityIds:["store"],unrestrictedFacilities:false};};export const receiptCorrectionCapabilities=async()=>({canRequest:true,canApprove:false});'
      : 'const f=globalThis.__receiptTrainingApi;export const receiptTrainingWorkspace=async()=>({trainingOnly:true});export const receiptTrainingAction=async(scope,command)=>{f.calls.push(command);return {id:"saved",idempotent:false};};' }));
  } }] });
  try {
    const { GET, POST } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    const url = 'https://portal.example.invalid/api/v1/training/receipt-corrections';
    const input = { sourceAccountId:'c123456789012345678901234',targetAccountId:'c223456789012345678901234',sourceEntryId:'c323456789012345678901234',amount:'75.25',reason:'Training allocation only',evidenceReference:'TRAINING-ONLY',requestKey:'550e8400-e29b-41d4-a716-446655440000' };
    const invoke = (body, origin = 'https://portal.example.invalid') => POST(new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:typeof body === 'string' ? body : JSON.stringify(body)}));
    const preview = {action:'preview',input};
    assert.equal((await invoke(preview,'https://other.example.invalid')).status,403);
    fixture.denied='anonymous';assert.equal((await GET(new Request(url))).status,401);
    fixture.denied='view';assert.equal((await invoke(preview)).status,403);
    fixture.denied=null;
    for (const body of ['{','x'.repeat(16385),{...preview,unexpected:true},{...preview,input:{...input,amount:'1e3'}}]) assert.equal((await invoke(body)).status,400);
    for (const decision of ['approve','reject']) assert.equal((await invoke({action:'decide',id:input.sourceAccountId,revision:0,decision,reference:'TRAINING',confirmed:true})).status,400);
    assert.equal((await invoke(preview)).status,200);
    const request={action:'request',input,fingerprint:'a'.repeat(64),confirmed:true};
    fixture.denied='request';assert.equal((await invoke(request)).status,403);
    fixture.denied=null;fixture.calls=[];assert.equal((await invoke(request)).status,200);
    assert.ok(fixture.calls.includes('request'));
    assert.equal((await invoke({...request,confirmed:false})).status,400);
    const response=await GET(new Request(url));assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
  } finally { delete globalThis.__receiptTrainingApi; }
});

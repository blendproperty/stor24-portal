import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {PrismaClientKnownRequestError} from '@prisma/client/runtime/client';

test('receipt correction HTTP boundary fails closed before finance actions and routes each action through its required scope', async () => {
  const before = globalThis.__receiptApi;
  const fixture = { calls: [], denied: null, dlp: null, failure: null, PrismaClientKnownRequestError };
  globalThis.__receiptApi = fixture;
  const built = await build({ entryPoints: ['src/app/api/v1/adjustments/receipt-reallocations/route.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'isolated-receipt-http', setup(b) {
    b.onResolve({filter:/^@prisma\/client\/runtime\/client$/},()=>({path:'prisma-runtime',namespace:'fixture'}));
    b.onResolve({ filter: /^@\/lib\/(db|receipt-reallocation-access|receipt-reallocation-service|receipt-reallocation-workspace|dlp-transfer-service)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => {
      const head = 'const f=globalThis.__receiptApi;';
      if(a.path==='prisma-runtime')return{contents:head+'export const PrismaClientKnownRequestError=f.PrismaClientKnownRequestError;'};
      if (a.path.endsWith('/db')) return { contents: 'export const db={};' };
      if (a.path.endsWith('access')) return { contents: head + 'export const receiptCorrectionScope=async(action="view")=>{f.calls.push(["scope",action]);if(f.denied===action)throw Error("FORBIDDEN");if(f.denied==="unauthenticated")throw Error("UNAUTHENTICATED");return {userId:"actor",organisationId:"org",facilityIds:["store"],unrestrictedFacilities:false};};export const receiptCorrectionCapabilities=async()=>({canRequest:true,canApprove:false});' };
      if (a.path.endsWith('/receipt-reallocation-service')) return { contents: head + 'export const requestReceiptReallocation=async(...args)=>{f.calls.push(["request",...args]);if(f.failure)throw f.failure;return {id:"saved",idempotent:false};};export const decideReceiptReallocation=async(...args)=>{f.calls.push(["decide",...args]);return {id:"saved",status:"POSTED",idempotent:false};};' };
      if (a.path.endsWith('workspace')) return { contents: head + 'export const receiptCorrectionWorkspace=async(...args)=>{f.calls.push(["workspace",...args]);return {requests:[]};};export const receiptCorrectionPreview=async(...args)=>{f.calls.push(["preview",...args]);return {fingerprint:"a".repeat(64)};};export const receiptCorrectionDocument=async()=>({content:"<html>Private account document</html>",facilityId:"store",documentId:"private-doc"});' };
      return { contents: head + 'export const protectDlpResponse=async(response,context)=>{f.calls.push(["dlp",context]);if(f.dlp)throw Error(f.dlp);return response;};' };
    });
  } }] });
  try {
    const { GET, POST } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    const input = { sourceAccountId: 'c123456789012345678901234', sourceEntryId: 'c223456789012345678901234', targetAccountId: 'c323456789012345678901234', amount: '25.25', reason: 'Documented receipt correction', evidenceReference: 'Staff source evidence', requestKey: '550e8400-e29b-41d4-a716-446655440000' };
    const invoke = (body, extra = {}) => POST(new Request('https://portal.example.invalid/api/v1/adjustments/receipt-reallocations', { method: 'POST', headers: { origin: 'https://portal.example.invalid', 'content-type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    const preview = { action: 'preview', input };
    for (const origin of ['', 'null', 'https://evil.example.invalid']) {
      fixture.calls = []; assert.equal((await invoke(preview, { origin })).status, 403); assert.equal(fixture.calls.length, 0);
    }
    fixture.denied = 'unauthenticated'; assert.equal((await invoke(preview)).status, 401);
    fixture.denied = 'view'; assert.equal((await invoke(preview)).status, 403);
    fixture.denied = null;
    for (const body of ['{', 'x'.repeat(16385), { ...preview, unknown: true }, { ...preview, input: { ...input, amount: '1e4' } }]) assert.equal((await invoke(body)).status, 400);
    assert.equal((await invoke(preview, { 'content-type': 'text/plain' })).status, 400);
    assert.equal((await invoke(preview, { 'content-type': 'application/jsonp' })).status, 400);
    assert.equal((await POST(new Request('https://portal.example.invalid/api/v1/adjustments/receipt-reallocations', { method: 'POST', headers: { origin: 'https://portal.example.invalid', 'content-type': 'application/json' }, body: new Uint8Array([255]) }))).status, 400);
    assert.equal((await invoke(preview, { 'content-length': '999999' })).status, 400);
    const request = { action: 'request', input, fingerprint: 'a'.repeat(64), confirmed: true };
    for (const confirmed of [false, undefined]) assert.equal((await invoke({ ...request, confirmed })).status, 400);
    fixture.calls = []; fixture.denied = 'request'; assert.equal((await invoke(request)).status, 403); assert.ok(!fixture.calls.some(c => c[0] === 'request'));
    fixture.denied = null; fixture.calls = []; assert.equal((await invoke(request)).status, 200);
    assert.ok(fixture.calls.some(c => c[0] === 'scope' && c[1] === 'request')); assert.equal(fixture.calls.filter(c => c[0] === 'request').length, 1);
    for(const state of ['40001','40P01']){
      fixture.failure=new PrismaClientKnownRequestError('Synthetic native raw rollback',{code:'P2010',clientVersion:'synthetic',meta:{driverAdapterError:{cause:{kind:'TransactionWriteConflict',originalCode:state}}}});
      assert.equal((await invoke(request)).status,409,'confirmed raw rollback is a review hold');
    }
    for(const failure of [new PrismaClientKnownRequestError('Unknown transaction outcome',{code:'P2028',clientVersion:'synthetic'}),new PrismaClientKnownRequestError('40001 message alone',{code:'P2010',clientVersion:'synthetic'}),{code:'P2010',meta:{driverAdapterError:{cause:{kind:'TransactionWriteConflict',originalCode:'40001'}}}}]){
      fixture.failure=failure;assert.equal((await invoke(request)).status,500,'unknown or code-shaped result cannot be classified as a confirmed rollback');
    }
    fixture.failure=null;
    fixture.denied = 'approve';
    assert.equal((await invoke({ action: 'decide', id: input.sourceEntryId, revision: 0, decision: 'approve', reference: 'Independent documented decision', confirmed: true })).status, 403);
    fixture.denied = null;
    for (const decision of ['approve', 'reject', 'cancel']) {
      fixture.calls = [];
      assert.equal((await invoke({ action: 'decide', id: input.sourceEntryId, revision: 0, decision, reference: 'Independent documented decision', confirmed: true })).status, 200);
      assert.ok(fixture.calls.some(c => c[0] === 'scope' && c[1] === (decision === 'cancel' ? 'request' : 'approve')));
      assert.equal(fixture.calls.filter(c => c[0] === 'decide').length, 1);
    }
    fixture.calls = []; assert.equal((await invoke(preview)).status, 200); assert.ok(!fixture.calls.some(c => ['request', 'decide'].includes(c[0])));
    const get = query => GET(new Request('https://portal.example.invalid/api/v1/adjustments/receipt-reallocations' + query));
    assert.equal((await get('')).headers.get('cache-control'), 'private, no-store, max-age=0');
    fixture.dlp = 'DLP_TRANSFER_BLOCKED'; assert.equal((await get(`?document=${input.sourceEntryId}&side=source`)).status, 422);
    fixture.dlp = null;
    const document = await get(`?document=${input.sourceEntryId}&side=target`); assert.equal(document.status, 200);
    assert.ok(document.headers.get('content-security-policy').includes("default-src 'none'"));
    assert.equal((await get(`?document=${input.sourceEntryId}&side=other`)).status, 400);
  } finally { if (before === undefined) delete globalThis.__receiptApi; else globalThis.__receiptApi = before; }
});

test('receipt permission scopes intersect store grants and reject identity mismatch or disjoint assignments', async () => {
  const built = await build({ entryPoints: ['src/lib/receipt-reallocation-access.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'isolated-receipt-scope', setup(b) {
    b.onResolve({ filter: /^\.\/scope$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const requirePermissionScope=async()=>{throw Error("Not used by this pure scope test")};' }));
  } }] });
  const { intersectReceiptScopes } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const scope = { userId: 'actor', organisationId: 'org', facilityIds: ['one', 'two'], unrestrictedFacilities: false };
  assert.deepEqual(intersectReceiptScopes([scope, { ...scope, facilityIds: ['two', 'three'] }]).facilityIds, ['two']);
  assert.deepEqual(intersectReceiptScopes([scope, { ...scope, facilityIds: [], unrestrictedFacilities: true }]).facilityIds, ['one', 'two']);
  assert.throws(() => intersectReceiptScopes([scope, { ...scope, facilityIds: ['three'] }]), /FORBIDDEN/);
  assert.throws(() => intersectReceiptScopes([scope, { ...scope, userId: 'other' }]), /FORBIDDEN/);
  assert.throws(() => intersectReceiptScopes([scope, { ...scope, organisationId: 'other' }]), /FORBIDDEN/);
});

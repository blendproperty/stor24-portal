import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReceiptReallocationWorkspace} from './src/components/receipt-reallocation-workspace';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1200,margin:'auto'}}><ReceiptReallocationWorkspace training={location.pathname === "/training"}/></main>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', outfile: 'output/receipt-staff-ui/app.js' });
const css = (await readFile('src/app/globals.css', 'utf8') + '\n' + await readFile('src/styles/stor24-brand.css', 'utf8')).replace('@import "tailwindcss";', '') + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? js : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css} body{font-family:Arial,sans-serif;margin:0;background:#f3f6f7}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
await mkdir('output/receipt-staff-ui', { recursive: true });
const id = n => 'c' + String(n).padStart(24, '0');
const [sourceId, targetId, facilityId, userId, ownId, reviewId, postedId, entryId, targetEntryId] = Array.from({ length: 9 }, (_, n) => id(n + 1));
const account = (accountId, number, balance, store = facilityId) => ({ id: accountId, accountNumber: number, balance, facilityId: store, customerName: 'Synthetic customer ' + number });
const accounts = [account(sourceId, 'SOURCE-001', '-200.00'), account(targetId, 'TARGET-002', '450.00'), account(id(10), 'OTHER-STORE', '0.00', id(11))];
const row = (rowId, requestedById, status = 'PENDING_APPROVAL') => ({ id: rowId, revision: 0, status, operation: 'MOVE', reversesId: null, sourceAccountId: sourceId, targetAccountId: targetId, sourceEntryId: entryId, facilityId, sourceAccountNumber: 'SOURCE-001', targetAccountNumber: 'TARGET-002', targetLedgerEntryId: status === 'POSTED' ? targetEntryId : null, amount: '75.25', reason: 'Synthetic retained receipt correction for source review', evidenceReference: 'EVIDENCE-' + rowId, requestedById, requestedByName: requestedById === userId ? 'Synthetic proposer' : 'Other synthetic proposer', createdAt: '2026-10-15T09:00:00.000Z', reviewReference: status === 'POSTED' ? 'Synthetic independent approval' : null, postedAt: status === 'POSTED' ? '2026-10-15T09:10:00.000Z' : null, retainedPreview: {sourceBalance:'-200.00',targetBalance:'450.00',sourceBalanceAfter:'-124.75',targetBalanceAfter:'374.75',sourceReceiptRemaining:'124.75',paymentReference:'STOR24 receipt '+id(30)} });
try {
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let mode = 'success', records = [row(ownId, userId), row(reviewId, id(12)), row(postedId, id(12), 'POSTED')];
    const commands = [], reads = [], created = new Map();
    const olderReceiptId=id(201); const olderRequest={...row(id(40),id(12),"REJECTED"),createdAt:"2026-10-14T09:00:00.000Z"};
    await page.route('**/api/v1/adjustments/receipt-reallocations**', async route => {
      const req = route.request(), url = new URL(req.url());
      if (req.method() === 'GET') {
        reads.push(Object.fromEntries(url.searchParams));
        if (mode === '403') return route.fulfill({ status: 403, json: { error: {} } });
        if (mode === 'malformed') return route.fulfill({ json: { data: { accounts: [] } } });
        const selectedSource = url.searchParams.get('sourceAccountId');
        const cursor=url.searchParams.get('receiptCursor');
        if(cursor){assert.ok(selectedSource);assert.ok(cursor.startsWith('receipt-'+selectedSource+'-'));}
        const makeReceipt=receiptId=>({entryId:receiptId,description:'Synthetic source receipt',recordedAt:'2026-10-15T08:00:00.000Z',remaining:'200.00',paymentReference:'VERIFIED-SYNTHETIC-RECEIPT'});
        const first=makeReceipt(selectedSource===targetId?targetEntryId:entryId);
        let receipts=[],nextReceiptCursor=selectedSource?'receipt-'+selectedSource+'-start':null;
        if(cursor?.endsWith('-start')){receipts=[first,...Array.from({length:24},(_,n)=>makeReceipt(id(1000+n)))];nextReceiptCursor='receipt-'+selectedSource+'-empty';}
        if(cursor?.endsWith('-empty'))nextReceiptCursor='receipt-'+selectedSource+'-older';
        if(cursor?.endsWith('-older')){receipts=[first,makeReceipt(olderReceiptId)];nextReceiptCursor=null;}
        const history=url.searchParams.has('cursor')?[olderRequest]:records;
        return route.fulfill({ json: { data: { userId, capabilities: { canRequest: true, canApprove: true }, facilities: [{ id: facilityId, name: 'Synthetic Midpoint' }, { id: id(11), name: 'Other synthetic store' }], accounts, accountsLimited: false, receipts, nextReceiptCursor, requests: mode === 'missing-preview' ? history.map(record => ({...record,retainedPreview:null})) : history, nextCursor:url.searchParams.has('cursor')?null:'request-page-2' } } });
      }
      const input = req.postDataJSON(); commands.push(input);
      if (input.action === 'preview') {
        if (mode === 'blocked-preview') return route.fulfill({ status: 422, json: { error: { message: 'Source changed. Refresh and review the receipt.' } } });
        const reverse = input.input.operation === 'UNDO';
        return route.fulfill({ json: { data: { fingerprint: 'a'.repeat(64), operation: input.input.operation, source: { accountNumber: reverse ? 'TARGET-002' : 'SOURCE-001', balance: reverse ? '374.75' : '-200.00' }, target: { accountNumber: reverse ? 'SOURCE-001' : 'TARGET-002', balance: reverse ? '-124.75' : '450.00' }, amount: mode === 'wrong-preview' ? '99.00' : input.input.amount, sourceBalanceAfter: reverse ? '400.00' : '-124.75', targetBalanceAfter: reverse ? '-150.00' : '374.75', sourceReceiptRemaining: '124.75', notice: 'Existing receipt only. No new payment or provider refund.' } } });
      }
      if (input.action === 'request') {
        assert.equal(input.confirmed, true);
        let saved = created.get(input.input.requestKey);
        if (!saved) { saved = id(20 + created.size); created.set(input.input.requestKey, saved); records.unshift({ ...row(saved, userId), ...input.input }); }
        if (mode === 'uncertain-request') { mode = 'success'; return route.abort(); }
        return route.fulfill({ json: { data: { id: saved, idempotent: commands.filter(command => command.action === 'request' && command.input.requestKey === input.input.requestKey).length > 1 } } });
      }
      assert.equal(input.action, 'decide'); assert.equal(input.confirmed, true);
      const saved = records.find(record => record.id === input.id); saved.status = input.decision === 'approve' ? 'POSTED' : input.decision === 'reject' ? 'REJECTED' : 'CANCELLED'; saved.revision++; saved.reviewReference = input.reference;
      if (mode === 'uncertain-decision') { mode = 'success'; return route.abort(); }
      return route.fulfill({ json: { data: { id: saved.id, status: saved.status, idempotent: false } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole('heading', { name: 'Receipt allocation corrections', exact: true })).toBeVisible();
    const own = page.locator('article').filter({ hasText: 'EVIDENCE-' + ownId });
    await own.getByText('View source and decision history',{exact:true}).click();
    await expect(own.getByRole('button', { name: 'Independently approve and post', exact: true })).toHaveCount(0);
    await expect(own.getByText('A different authorised colleague', { exact: false })).toBeVisible();
    mode = 'missing-preview'; await page.getByRole('button', { name: 'Refresh recorded state', exact: true }).click();
    const missing = page.locator('article').filter({ hasText: 'EVIDENCE-' + reviewId });
    await missing.getByText('View source and decision history',{exact:true}).click();
    await expect(missing.getByText('The retained submission preview is unavailable.', {exact:false})).toBeVisible();
    await missing.getByText('Review decision options', { exact: true }).click();
    await missing.getByLabel('Independent review or cancellation reference', { exact: true }).fill('Synthetic source review');
    await missing.getByLabel('I checked this correction and its retained source evidence.', { exact: true }).check();
    await expect(missing.getByRole('button',{name:'Independently approve and post',exact:true})).toBeDisabled();
    const unavailableUndo = page.locator('article').filter({hasText:'EVIDENCE-'+postedId});
    await unavailableUndo.getByText('View source and decision history',{exact:true}).click();
    await expect(unavailableUndo.getByRole('button',{name:'Prepare an undo request',exact:true})).toBeDisabled();
    mode = 'success'; await page.getByRole('button', { name: 'Refresh recorded state', exact: true }).click();
    await page.getByLabel('Source account', { exact: true }).selectOption(sourceId);
    await expect(page.getByLabel('Verified receipt position', { exact: true })).toBeEnabled();
    await expect(page.getByText('No eligible verified receipts on this page.',{exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Load more receipts',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Load more receipts',exact:true}).click();
    await expect(page.getByLabel('Verified receipt position',{exact:true}).locator('option')).toHaveCount(26);
    await page.getByLabel('Destination account', { exact: true }).selectOption(targetId);
    await expect(page.getByLabel('Destination account', { exact: true }).locator('option')).toHaveCount(2);
    await page.getByLabel('Verified receipt position', { exact: true }).selectOption(entryId);
    await page.getByLabel('Amount in rand', { exact: true }).fill('75.25');
    await page.getByLabel('Source evidence reference', { exact: true }).fill('Synthetic bank evidence');
    await page.getByLabel('Correction reason', { exact: true }).fill('Correct the documented synthetic allocation');
    mode = 'blocked-preview'; await page.getByRole('button', { name: 'Preview account changes', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Source changed');
    await expect(page.getByRole('button', { name: 'Submit for independent review', exact: true })).toHaveCount(0);
    mode = 'wrong-preview'; await page.getByRole('button', { name: 'Preview account changes', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('preview differs');
    mode = 'success'; await page.getByRole('button', { name: 'Preview account changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Submit for independent review', exact: true })).toBeDisabled();
    await page.getByRole('button',{name:'Load older requests',exact:true}).click();
    await expect(page.locator('article')).toHaveCount(4);
    await expect(page.getByLabel('Verified receipt position',{exact:true})).toHaveValue(entryId);
    await expect(page.getByLabel('Verified receipt position',{exact:true}).locator('option')).toHaveCount(26);
    await page.getByRole('button',{name:'Preview account changes',exact:true}).click();
    await page.getByRole('button',{name:'Load more receipts',exact:true}).click();
    await expect.poll(()=>reads.at(-1)?.receiptCursor).toBe('receipt-'+sourceId+'-empty');
    await expect(page.getByRole('button',{name:'Load more receipts',exact:true})).toBeEnabled();
    await expect(page.getByLabel('Verified receipt position',{exact:true})).toHaveValue(entryId);
    await expect(page.locator('article')).toHaveCount(4);
    await expect(page.getByRole('region',{name:'Correction preview'})).toHaveCount(0);
    await page.getByRole('button',{name:'Load more receipts',exact:true}).click();
    await expect(page.getByLabel('Verified receipt position',{exact:true}).locator('option')).toHaveCount(27);
    await expect(page.getByLabel('Verified receipt position',{exact:true})).toHaveValue(entryId);
    await expect(page.locator('article')).toHaveCount(4);
    await expect(page.getByRole('button',{name:'Load older requests',exact:true})).toHaveCount(0);
    await page.getByLabel('Verified receipt position',{exact:true}).selectOption(olderReceiptId);
    await page.getByRole('button',{name:'Preview account changes',exact:true}).click();
    assert.equal(commands.findLast(command=>command.action==='preview').input.sourceEntryId,olderReceiptId);

    await page.getByLabel('Amount in rand', { exact: true }).fill('76.25');
    await expect(page.getByRole('region', { name: 'Correction preview' })).toHaveCount(0);
    await page.getByLabel('Amount in rand', { exact: true }).fill('75.25');
    await page.getByRole('button', { name: 'Preview account changes', exact: true }).click();
    await page.getByLabel('I checked the source receipt, both accounts and this amount.', { exact: true }).check();
    mode = 'uncertain-request'; await page.getByRole('button', { name: 'Submit for independent review', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('whether this request was saved');
    await expect(page.getByLabel('Amount in rand', { exact: true })).toBeDisabled();
    const original = structuredClone(commands.findLast(command => command.action === 'request'));
    await page.getByRole('button', { name: 'Retry exactly the same request', exact: true }).click();
    await expect(page.getByRole('status').filter({hasText:'Request recorded'})).toBeVisible();
    assert.deepEqual(commands.findLast(command => command.action === 'request'), original);
    assert.equal(created.size, 1);
    const reviewer = page.locator('article').filter({ hasText: 'EVIDENCE-' + reviewId });
    await reviewer.getByText('View source and decision history',{exact:true}).click();
    await reviewer.getByText('Review decision options', { exact: true }).click();
    await reviewer.getByLabel('Independent review or cancellation reference', { exact: true }).fill('Independent synthetic approval');
    await reviewer.getByLabel('I checked this correction and its retained source evidence.', { exact: true }).check();
    mode = 'uncertain-decision'; await reviewer.getByRole('button', { name: 'Independently approve and post', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Refresh and inspect');
    await expect(page.getByRole('button', { name: 'Preview account changes', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Refresh recorded state', exact: true }).click();
    await expect(reviewer.getByText('POSTED', { exact: true })).toBeVisible();
    await expect(reviewer.getByRole('button', { name: 'Independently approve and post', exact: true })).toHaveCount(0);
    const posted = page.locator('article').filter({ hasText: 'EVIDENCE-' + postedId });
    await posted.getByText('View source and decision history',{exact:true}).click();
    await posted.getByRole('button', { name: 'Prepare an undo request', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prepare an allocation undo', exact: true })).toBeVisible();
    await expect(page.getByLabel('Source account', { exact: true })).toHaveValue(targetId);
    await expect(page.getByLabel('Destination account', { exact: true })).toHaveValue(sourceId);
    await expect(page.getByLabel('Source account', { exact: true })).toBeDisabled();
    await expect.poll(()=>reads.at(-1)?.sourceAccountId).toBe(targetId);
    assert.equal(reads.at(-1).receiptCursor,undefined,'source change resets receipt cursor');
    await expect(page.getByLabel('Verified receipt position',{exact:true}).locator(`option[value="${olderReceiptId}"]`)).toHaveCount(0);
    await page.getByRole('button',{name:'Load more receipts',exact:true}).click();
    await expect(page.getByLabel('Verified receipt position',{exact:true}).locator(`option[value="${targetEntryId}"]`)).toHaveCount(1);

    await page.getByLabel('Amount in rand', { exact: true }).fill('25.25');
    await page.getByLabel('Source evidence reference', { exact: true }).fill('Synthetic undo evidence');
    await page.getByLabel('Correction reason', { exact: true }).fill('Undo the retained synthetic allocation');
    await page.getByRole('button', { name: 'Preview account changes', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Correction preview' })).toBeVisible();
    const undo = commands.findLast(command => command.action === 'preview').input;
    assert.equal(undo.operation, 'UNDO'); assert.equal(undo.reversesId, postedId); assert.equal(undo.sourceEntryId, targetEntryId);
    for (const control of await page.locator('input,select,textarea,button').all()) {
      if (!await control.isVisible()) continue;
      const box = await control.boundingBox(); assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, 'every visible control fits the narrow viewport');
    }
    await page.screenshot({ path: `output/receipt-staff-ui/${width}.png`, fullPage: true });
    mode = '403'; await page.getByRole('button', { name: 'Refresh recorded state', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('cannot view receipt corrections');
    await expect(page.getByRole('heading', { name: 'Retained requests and decisions', exact: true })).toHaveCount(0);
    mode = 'malformed'; await page.getByRole('button', { name: 'Refresh recorded state', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('records could not be verified');
    mode = 'success'; await page.getByRole('button', { name: 'Refresh recorded state', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Retained requests and decisions', exact: true })).toBeVisible();
    assert.deepEqual(errors, []); await page.close();
  }
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let records = []; const writes = [];
    await page.route('**/api/v1/training/receipt-corrections**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'GET') {
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        return route.fulfill({ json: { data: { userId, capabilities: {canRequest:true,canApprove:false}, facilities:[{id:facilityId,name:'Midpoint training'}], accounts:accounts.slice(0,2).filter(a => !search || a.accountNumber.toLowerCase().includes(search)), accountsLimited:false, receipts:url.searchParams.get('sourceAccountId')===sourceId?[{entryId,description:'Training receipt',recordedAt:'2026-10-19T06:00:00.000Z',remaining:'200.00',paymentReference:'TRAINING SAMPLE ONLY'}]:[], requests:records, nextCursor:null,nextReceiptCursor:null } } });
      }
      const command = request.postDataJSON(); writes.push(command);
      assert.ok(command.action !== 'decide' || command.decision === 'cancel');
      if (command.action === 'preview') return route.fulfill({ json:{data:{fingerprint:'a'.repeat(64),operation:'MOVE',source:{accountNumber:'SOURCE-001',balance:'-200.00'},target:{accountNumber:'TARGET-002',balance:'450.00'},amount:'75.25',sourceBalanceAfter:'-124.75',targetBalanceAfter:'374.75',sourceReceiptRemaining:'124.75',notice:'TRAINING ONLY - no approval or posting'}} });
      if (command.action === 'request') { records=[{...row(ownId,userId),...command.input}]; return route.fulfill({json:{data:{id:ownId,idempotent:false}}}); }
      records[0].status='CANCELLED';records[0].revision=1;
      return route.fulfill({json:{data:{id:ownId,status:'CANCELLED',idempotent:false}}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/training`);
    await expect(page.getByRole('heading',{name:'Receipt correction training',exact:true})).toBeVisible();
    await expect(page.getByText('TRAINING ONLY: two sample accounts', {exact:false})).toBeVisible();
    await page.getByLabel('Find an account',{exact:true}).fill('unknown');await page.getByRole('button',{name:'Search accounts',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('No training accounts match');
    await page.getByLabel('Find an account',{exact:true}).fill('');await page.getByRole('button',{name:'Search accounts',exact:true}).click();
    await page.getByLabel('Source account',{exact:true}).selectOption(sourceId);
    await page.getByLabel('Destination account',{exact:true}).selectOption(targetId);
    await page.getByLabel('Verified receipt position',{exact:true}).selectOption(entryId);
    await page.getByLabel('Amount in rand',{exact:true}).fill('75.25');
    await page.getByLabel('Source evidence reference',{exact:true}).fill('TRAINING-ONLY');
    await page.getByLabel('Correction reason',{exact:true}).fill('Training receipt allocation only');
    await page.getByRole('button',{name:'Preview account changes',exact:true}).click();
    await expect(page.getByRole('region',{name:'Correction preview'})).toBeVisible();
    await page.getByLabel('I checked the source receipt, both accounts and this amount.',{exact:true}).check();
    await page.getByRole('button',{name:'Save training request',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Saved training requests',exact:true})).toBeVisible();
    await page.reload();await expect(page.locator('article')).toHaveCount(1);
    await page.getByText('View source and decision history',{exact:true}).click();
    await expect(page.getByRole('button',{name:'Independently approve and post',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Prepare an undo request',exact:true})).toHaveCount(0);
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth > innerWidth),false);
    await page.screenshot({path:`output/receipt-staff-ui/training-${width}.png`,fullPage:true});
    await page.getByText('Cancellation options',{exact:true}).click();
    await page.getByLabel('Independent review or cancellation reference',{exact:true}).fill('TRAINING-CANCEL');
    await page.getByLabel('I checked this correction and its retained source evidence.',{exact:true}).check();
    await page.getByRole('button',{name:'Cancel my request',exact:true}).click();
    await expect(page.locator('article')).toContainText('CANCELLED');
    assert.equal(writes.filter(w=>w.action==='request').length,1);
    await page.close();
  }
  console.log('Receipt staff actual-component workflow passed1440/768/390/320: scoped choices, preview/source holds, edit invalidation, immutable uncertain retry, independent review, uncertain decision refresh, retained undo, independent receipt/history cursors, empty receipt pages, earlier selection and source reset, and direct control bounds.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

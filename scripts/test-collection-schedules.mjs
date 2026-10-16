import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CollectionSchedules} from './src/components/collection-schedules';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1200,margin:'auto'}}><CollectionSchedules/></main>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', outfile: 'output/collection-schedules/app.js' });
const css = (await readFile('src/app/globals.css', 'utf8') + '\n' + await readFile('src/styles/stor24-brand.css', 'utf8')).replace('@import "tailwindcss";', '') + '\n' + (bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '');
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? js : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{font-family:Arial,sans-serif;margin:0;background:#f3f6f7}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(); await mkdir('output/collection-schedules', { recursive: true });
const id = n => 'c' + String(n).padStart(24, '0'), revision = '32a1767c-5b58-4534-9cd0-04dd02666a7a', planId = 'collection-plan:' + revision, runId = 'collection-run:' + 'b'.repeat(64);
const proofs = [];
try {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }), writes = [], errors = []; let retained = null, reviewer = false, expiredSession = false, runStatus = 'PENDING_REVIEW';
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/collections/schedules**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (expiredSession) return route.fulfill({ status: 401, json: { error: 'Sign in again to review schedules.' } });
      if (request.method() === 'GET') {
        const facilityId = url.searchParams.get('facilityId') || '';
        return route.fulfill({ json: { data: { actorId: reviewer ? id(5) : id(4), facilities: [{ id: id(1), name: 'Synthetic Midpoint' }], facilityId, accounts: [{ id: id(2), accountNumber: 'TEST-ACCOUNT', customer: 'Synthetic customer' }], moreAccounts: false, plans: retained ? [{ id: planId, createdAt: '2026-10-15T10:00:00.000Z', state: retained }] : [], selectedPlan: url.searchParams.get('planId') && retained ? { id: planId, state: retained } : null, runs: url.searchParams.get('planId') && retained ? [{ id: runId, createdAt: '2026-10-15T10:00:00.000Z', state: { kind: 'RUN', revision, planId, planFingerprint: 'a'.repeat(64), day: '2026-10-15', expires: '2026-10-15T11:00:00.000Z', status: runStatus, items: [{ accountId: id(2), noticeId: 'collection-email:' + 'c'.repeat(64), revision, recipient: 'synthetic-customer@example.invalid', subject: 'STOR24 account payment reminder', text: 'Synthetic training letter. R100.00 overdue as at 2026-10-15. No real recipient is contacted.', sourceFingerprint: 'd'.repeat(64) }], held: [], fingerprint: 'e'.repeat(64), reviewerId: runStatus === 'APPROVED' ? id(5) : null, reviewedAt: runStatus === 'APPROVED' ? '2026-10-15T10:05:00.000Z' : null, reference: runStatus === 'APPROVED' ? 'Synthetic exact letter review' : null } }] : [], nextCursor: null, nextRunCursor: null, canManage: Boolean(facilityId), canApprove: Boolean(facilityId), sendingEnabled: false } } });
      }
      const input = request.postDataJSON(); writes.push(input); assert.ok(['create', 'evaluate', 'cancel-plan', 'review-run'].includes(input.action));
      assert.ok(!('enabled' in input) && !('reviewerId' in input), 'No activation or fabricated reviewer command');
      if (input.action === 'create') { assert.equal(input.input.dueTime, '11:00'); assert.equal(input.input.reviewMinutes, 120); assert.deepEqual(input.input.weekdays, [4]); assert.deepEqual(input.input.accountIds, [id(2)]); retained = { kind: 'PLAN', revision, input: input.input, creatorId: id(4), senderFingerprint: 'f'.repeat(64), fingerprint: 'a'.repeat(64), status: 'ACTIVE' }; }
      if (input.action === 'review-run') { assert.equal(reviewer, true); assert.equal(input.fingerprint, 'e'.repeat(64)); assert.equal(input.confirm, true); assert.equal(input.reference, 'Synthetic exact letter review'); runStatus = 'APPROVED'; }
      return route.fulfill({ json: { data: { id: planId, emailSent: false } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByText('Automatic dispatch is off', { exact: true })).toBeVisible();
    await page.getByLabel('Schedule store', { exact: true }).selectOption(id(1)); await page.getByRole('button', { name: 'New schedule', exact: true }).click();
    for (const name of ['First South African day', 'Last South African day', 'Due time (SAST)', 'Review and delivery window (minutes)']) await expect(page.getByLabel(name, { exact: true })).toHaveValue('');
    assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
    await page.getByLabel('Schedule name', { exact: true }).fill('Synthetic reviewed arrears'); await page.getByLabel('First South African day', { exact: true }).fill('2026-10-15'); await page.getByLabel('Last South African day', { exact: true }).fill('2026-10-16'); await page.getByLabel('Due time (SAST)', { exact: true }).fill('11:00'); await page.getByLabel('Review and delivery window (minutes)', { exact: true }).fill('120');
    await page.getByLabel('Thursday', { exact: true }).check(); await page.getByLabel('TEST-ACCOUNT · Synthetic customer', { exact: true }).check();
    await page.getByRole('button', { name: 'Save schedule for per-run staff review', exact: true }).click();
    await expect(page.getByText('synthetic-customer@example.invalid · STOR24 account payment reminder', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve this run for configured dispatch', exact: true })).toHaveCount(0);
    assert.equal(await page.getByLabel('Schedule name', { exact: true }).count(), 0, 'Composer closes after retained save');
    reviewer = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve this run for configured dispatch', exact: true })).toBeDisabled();
    await page.getByLabel('Review or cancellation reference', { exact: true }).fill('Synthetic exact letter review'); await page.getByLabel('I reviewed every recipient and exact letter shown above, including held accounts.', { exact: true }).check();
    await page.screenshot({ path: `output/collection-schedules/review-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');
    await page.getByRole('button', { name: 'Approve this run for configured dispatch', exact: true }).click(); await expect(page.getByRole('heading', { name: '2026-10-15 · APPROVED', exact: true })).toBeVisible();
    assert.equal(writes.filter(w => w.action === 'create').length, 1); assert.equal(writes.filter(w => w.action === 'review-run').length, 1);
    expiredSession = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByRole('alert')).toHaveText('Sign in again to review schedules.'); await expect(page.getByText('synthetic-customer@example.invalid · STOR24 account payment reminder', { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []); proofs.push({ width, explicitBlankChoices: true, selfApprovalHidden: true, exactRunReview: true, writes: writes.map(w => w.action), realProviderCalls: 0, staleSessionCleared: true, overflow: false, errors }); await page.close();
  }
  await writeFile('output/collection-schedules/browser-proof.json', JSON.stringify(proofs, null, 2)); console.log(JSON.stringify(proofs, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

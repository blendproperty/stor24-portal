import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('Customer history').addRow(['Synthetic history fixture']);
const excelFixture = await workbook.xlsx.writeBuffer();
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CustomerHistory} from './src/components/customer-history';function App(){const [id,setId]=React.useState('synthetic');return <main style={{padding:20,maxWidth:1100,margin:'auto'}}><button onClick={()=>setId(id==='synthetic'?'other':'synthetic')}>Switch customer</button><CustomerHistory key={id} customerId={id}/></main>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic' });
const css = (await readFile('src/app/globals.css', 'utf8') + '\n' + await readFile('src/styles/stor24-brand.css', 'utf8')).replace('@import "tailwindcss";', '');
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
await mkdir('output/customer-history', { recursive: true });
const entry = { id: 'one', kind: 'NOTE', at: '2026-10-14T09:30:00.000Z', title: 'Staff handover', body: 'Customer called.\nCovering staff to check the arrival.', category: 'HANDOVER', author: 'Synthetic Faeez', facility: 'Midpoint', channel: null, status: null, sentAt: null, deliveredAt: null, readAt: null };
const comm = { ...entry, id: 'two', kind: 'COMMUNICATION', title: 'EMAIL · RESERVATION CONFIRMED', body: 'Outbound communication record', category: null, author: null, channel: 'EMAIL', status: 'PENDING', sentAt: null };
const initial = { entries: [entry, comm], nextCursor: 'older-page', facilities: [{ id: 'store', name: 'Midpoint' }], writableFacilities: [{ id: 'store', name: 'Midpoint' }], visibility: { communications: true, collections: true }, legacyNotes: 'Earlier customer summary', canExport: true };
try {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let mode = 'success', writes = [], downloads = [], reads = [], olderKind, saved = false;
    await page.route('**/api/v1/customers/*/history**', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.pathname.endsWith('/export')) { downloads.push(req.postDataJSON()); return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(excelFixture) }); }
      if (req.method() === 'POST') {
        const input = req.postDataJSON(); writes.push(input);
        if (mode === 'uncertain') { saved = true; return route.abort(); }
        if (mode === '422') return route.fulfill({ status: 422, json: { error: {} } });
        if (mode === 'hold') return;
        return route.fulfill({ json: { data: { id: 'new-note', createdAt: entry.at } } });
      }
      reads.push(Object.fromEntries(url.searchParams));
      if (mode === '401' || mode === '403' || mode === '500') return route.fulfill({ status: Number(mode), json: { error: {} } });
      if (mode === 'malformed') return route.fulfill({ json: { data: {} } });
      if (mode === 'read-hold') return;
      if (url.pathname.includes('/other/')) return route.fulfill({ json: { data: { ...initial, entries: [{ ...entry, id: 'other-entry', body: 'Other customer history' }], nextCursor: null } } });
      if (url.searchParams.has('cursor')) { olderKind = url.searchParams.get('kind'); return route.fulfill({ json: { data: { ...initial, entries: [{ ...entry, id: 'old', body: 'Older customer call' }], nextCursor: null } } }); }
      if (url.searchParams.get('category')) return route.fulfill({ json: { data: { ...initial, entries: [entry], nextCursor: null } } });
      return route.fulfill({ json: { data: { ...initial, entries: saved ? [{ ...entry, id: 'new-note', body: writes.at(-1).body }, entry, comm] : initial.entries } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByText('Customer called.', { exact: false })).toBeVisible();
    await expect(page.locator('time').first()).toContainText('11:30 SAST');
    await expect(page.getByText('Recorded status: PENDING')).toBeVisible();
    await expect(page.getByText('Delivered', { exact: false })).toHaveCount(0);
    await page.getByText('Date and communication filters', { exact: true }).click();
    await page.getByLabel('From date (SAST)').fill('2026-10-14');
    await page.getByLabel('To date (SAST)').fill('2026-10-14');
    await page.getByLabel('Communication channel').selectOption('WHATSAPP');
    await page.getByLabel('Recorded send status').selectOption('SUCCEEDED');
    await page.getByLabel('Search history').fill('weekend');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('Recorded status: PENDING')).toBeVisible();
    assert.deepEqual(reads.at(-1), { kind: 'ALL', search: 'weekend', from: '2026-10-14', to: '2026-10-14', channel: 'WHATSAPP', status: 'SUCCEEDED' });
    await page.getByLabel('Search history').fill('unsaved draft');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Excel', exact: true }).click(); await downloaded;
    assert.deepEqual(downloads.at(-1), { format: 'XLSX', ...reads.at(-1) }, 'downloads use applied filters, not draft edits');
    for (const label of ['From date (SAST)', 'To date (SAST)', 'Search history']) await page.getByLabel(label).fill('');
    await page.getByLabel('Communication channel').selectOption(''); await page.getByLabel('Recorded send status').selectOption('');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('Recorded status: PENDING')).toBeVisible();
    await page.getByLabel('History type').selectOption('NOTE');
    await page.getByRole('button', { name: 'Load older history' }).click();
    await expect(page.getByText('Older customer call')).toBeVisible();
    assert.equal(olderKind, 'ALL', 'draft filters cannot corrupt pagination');
    await page.getByLabel('Note category', { exact: true }).selectOption('HANDOVER');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('Recorded status: PENDING')).toHaveCount(0);
    mode = '422';
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await page.getByLabel('Staff note', { exact: true }).fill('Agreed customer follow-up');
    await page.getByRole('button', { name: 'Save staff note' }).click();
    await expect(page.getByRole('alert')).toContainText('Choose a store');
    await expect(page.getByLabel('Staff note', { exact: true })).toHaveValue('Agreed customer follow-up');
    mode = 'uncertain';
    await page.getByRole('button', { name: 'Save staff note' }).click();
    await expect(page.getByRole('alert')).toContainText('could not confirm');
    await expect(page.getByLabel('Staff note', { exact: true })).toBeDisabled();
    const pending = writes.at(-1);
    mode = 'success';
    await page.getByRole('button', { name: 'Retry same note' }).click();
    await expect(page.getByText('Note saved.', { exact: false })).toBeVisible();
    assert.deepEqual(writes.at(-1), pending);
    await expect(page.locator('.customer-timeline-body').filter({ hasText: 'Agreed customer follow-up' })).toHaveCount(1);
    for (const failure of ['500', 'malformed', '401', '403']) {
      mode = failure; await page.getByRole('button', { name: 'Refresh history' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.locator('.customer-timeline li')).toHaveCount(0);
      mode = 'success'; await page.getByRole('button', { name: 'Retry history' }).click();
      await expect(page.getByRole('heading', { name: 'Staff handover', exact: true }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'Switch customer' }).click();
    await expect(page.getByText('Other customer history')).toBeVisible();
    await expect(page.getByText('Agreed customer follow-up', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Switch customer' }).click();
    await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await page.getByLabel('Staff note', { exact: true }).fill('Timeout retry evidence');
    mode = 'hold'; await page.clock.install();
    const before = writes.length;
    await page.getByRole('button', { name: 'Save staff note' }).click();
    await page.getByRole('button', { name: 'Saving note…' }).evaluate(b => { b.click(); b.click(); });
    await page.clock.fastForward(21000);
    await expect(page.getByRole('alert')).toContainText('could not confirm');
    assert.equal(writes.length, before + 1);
    mode = 'success'; await page.getByRole('button', { name: 'Retry same note' }).click();
    await expect(page.getByRole('button', { name: 'Save staff note' })).toBeVisible();
    await page.getByRole('button', { name: 'Save staff note' }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow');
    await page.screenshot({ path: `output/customer-history/${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px: history/category/search/paging, SAST, idempotent retry, timeout/duplicate, access/error recovery and customer switching`);
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }

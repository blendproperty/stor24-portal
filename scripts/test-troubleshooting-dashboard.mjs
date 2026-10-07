import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle = await build({ stdin: { contents: "import React from 'react';import {createRoot} from 'react-dom/client';import {TroubleshootingDashboard} from './src/components/troubleshooting-dashboard';createRoot(document.getElementById('root')).render(<TroubleshootingDashboard/>);", resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', plugins: [{ name: 'link', setup(b) { b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react';export default function Link(p){return <a {...p}/>}", loader: 'jsx', resolveDir: process.cwd() })); } }] });
const css = await readFile('src/app/globals.css', 'utf8'); const font = await readFile('public/brand/Satoshi-Variable.ttf');
const server = createServer((req, res) => {
  if (req.url === '/font.ttf') { res.end(font); return; }
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>@font-face{font-family:Satoshi;src:url(/font.ttf);font-weight:300 900}:root{--font-satoshi:Satoshi}</style></head><body><main style="padding:24px"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const browser = await chromium.launch(); await mkdir('output/troubleshooting', { recursive: true });
const stamp = new Date().toISOString();
const cards = [
  ['website', 'Website', 'good', 'Responding now'], ['database', 'Database', 'good', 'Read check passed'],
  ['disk', 'Server storage', 'critical', '88% used'], ['memory', 'Server memory', 'good', '62% available'],
  ['backup', 'Encrypted local backup', 'warning', 'Freshness not verified'], ['monitor', 'External monitor', 'unknown', 'Evidence is stale'],
].map(([id, title, state, value]) => ({ id, title, state, value, detail: 'Synthetic operational evidence. No production systems connected.', next: 'Review the server evidence before changing any service.', checkedAt: stamp }));
const data = { checkedAt: stamp, cards, host: { appHealth: 'healthy', oomKilled: false, databaseConnections: 7, databaseLimit: 100, image: 'stor24-crm:1234567' }, hostFresh: true, backup: { restoredAt: stamp, offSite: false }, messagingConfigured: ['Email', 'SMS', 'WhatsApp'], activeRecipients: 2, connections: [{ provider: 'HikCentral', status: 'CONFIGURED', checkedAt: null, stale: true }], queues: { incoming: { pending: 1, failed: 2 }, outgoing: { pending: 0, failed: 0 } }, history: [{ runId: '123', checkedAt: stamp, readiness: 'failure', backup: 'success', kind: 'FAILURE', status: 'ATTEMPTED', recipientSource: 'SAVED_RECIPIENTS', channels: [{ channel: 'EMAIL', accepted: 2, failed: 0 }, { channel: 'SMS', accepted: 0, failed: 1 }] }] };
try {
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); const errors = []; let fail = true; let reads = 0;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/v1/operations/diagnostics', async route => { assert.equal(route.request().method(), 'GET'); reads++; return fail ? route.abort() : route.fulfill({ json: { data } }); });
    await page.route('**/api/v1/operations/diagnostics?export=json', async route => { assert.equal(route.request().method(), 'GET'); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }); });
    await page.goto(`http://127.0.0.1:${server.address().port}`); await expect(page.getByRole('alert')).toContainText('could not refresh');
    fail = false; await page.getByRole('button', { name: 'Refresh checks' }).click(); await expect(page.getByText('88% used')).toBeVisible(); await expect(page.getByText('Evidence is stale', { exact: true })).toBeVisible();
    const storage = page.getByRole('article').filter({ hasText: 'Server storage' }); await storage.locator('summary').click(); await expect(storage.getByText('Review the server evidence before changing any service.', { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download diagnostics' }).click(); const download = await downloadPromise; const report = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(report.cards[2].state, 'critical'); assert.equal(report.history[0].channels[1].failed, 1);
    await page.screenshot({ path: `output/troubleshooting/dashboard-${width}.png`, fullPage: true }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`);
    fail = true; await page.getByRole('button', { name: 'Refresh checks' }).click(); await expect(page.getByRole('alert')).toContainText('out of date'); await expect(page.getByText('88% used')).toBeVisible(); assert.equal(reads, 3); assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS troubleshooting: read-only refresh/load recovery, stale and critical evidence, next steps, safe diagnostic download, responsive1440/768/390/320 and no browser errors.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }

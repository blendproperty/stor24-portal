import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const pdf = await readFile('private/staff-training/stor24-staff-handbook-2026-10-15.pdf');
const css = (await readFile('src/app/globals.css', 'utf8') + '\n' + await readFile('src/styles/stor24-brand.css', 'utf8')).replace('@import "tailwindcss";', '');
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StaffHandbookDownload} from './src/components/staff-handbook-download';createRoot(document.getElementById('root')).render(<main><h1>Operations</h1><StaffHandbookDownload/></main>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic' });
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
await mkdir('output/staff-handbook-download', { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let mode = 'success', requests = 0, release;
    await page.route('**/api/v1/operations/staff-guide', async route => {
      requests++; assert.equal(route.request().method(), 'GET');
      if (mode === 'hold') await new Promise(resolve => { release = resolve; });
      if (['401', '403', '422', '500'].includes(mode)) return route.fulfill({ status: Number(mode), json: { error: { message: mode === '422' ? 'Data protection blocked this download.' : 'Handbook temporarily unavailable.' } } });
      if (mode === 'html') return route.fulfill({ contentType: 'text/html', body: '<html>Sign in</html>' });
      if (mode === 'empty') return route.fulfill({ contentType: 'application/pdf', body: '' });
      if (mode === 'invalid') return route.fulfill({ contentType: 'application/pdf', body: 'not a PDF' });
      return route.fulfill({ contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="STOR24-staff-handbook-2026-10-15.pdf"', 'cache-control': 'private, no-store' }, body: pdf });
    });
    const origin = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(origin);
    for (mode of ['401', '403', '422', '500', 'html', 'empty', 'invalid']) {
      await page.getByRole('button', { name: 'Staff handbook PDF', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      if (mode === '422') await expect(page.getByRole('alert')).toContainText('Data protection blocked');
      assert.equal(page.url(), origin, 'failed download retains Operations rather than navigating to an API error');
      await expect(page.getByRole('button', { name: 'Staff handbook PDF', exact: true })).toBeEnabled();
    }
    mode = 'hold'; const before = requests;
    await page.getByRole('button', { name: 'Staff handbook PDF', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Preparing handbook…', exact: true })).toBeDisabled();
    await expect.poll(() => requests).toBe(before + 1);
    const download = page.waitForEvent('download'); release();
    const file = await download;
    assert.equal(file.suggestedFilename(), 'STOR24-staff-handbook-2026-10-15.pdf');
    assert.equal(createHash('sha256').update(await readFile(await file.path())).digest('hex'), createHash('sha256').update(pdf).digest('hex'));
    await expect(page.getByRole('alert')).toHaveCount(0);
    assert.equal(page.url(), origin);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `output/staff-handbook-download/${width}.png` });
    await page.close();
  }
  console.log('Handbook normal button download, exact PDF hash, denied/DLP/server/malformed recovery and duplicate guard passed at1440/390/320.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

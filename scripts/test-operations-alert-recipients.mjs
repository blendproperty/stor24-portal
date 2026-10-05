import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { contents: "import React from 'react';import {createRoot} from 'react-dom/client';import {OperationsAlertRecipients} from './src/components/operations-alert-recipients';createRoot(document.getElementById('root')).render(<OperationsAlertRecipients/>);", resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic' });
const css = await readFile('src/app/globals.css', 'utf8');
const font = await readFile('public/brand/Satoshi-Variable.ttf');
const server = createServer((req, res) => {
  if (req.url === '/font.ttf') { res.setHeader('Content-Type', 'font/ttf'); res.end(font); return; }
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>@font-face{font-family:Satoshi;src:url(/font.ttf);font-weight:300 900}:root{--font-satoshi:Satoshi}</style></head><body><main style="padding:24px"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const row = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic owner', email: 'owner@example.invalid', mobile: '+12025550100', channels: ['EMAIL', 'SMS', 'WHATSAPP'], enabled: true, consent: true };
await mkdir('output/operations-alert-recipients', { recursive: true });
try {
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let mode = 'load-fail', writes = 0, saved = { recipients: [row], revision: '2026-10-05T00:00:00.000Z' };
    await page.route('**/api/v1/operations/alert-recipients', async route => {
      if (route.request().method() === 'GET') return mode === 'load-fail' ? route.abort() : route.fulfill({ json: { data: saved } });
      writes++;
      if (mode === 'uncertain') return route.abort();
      if (mode === 'rejected') return route.fulfill({ status: 422, json: { error: { message: 'Synthetic validation rejection' } } });
      if (mode === 'conflict') return route.fulfill({ status: 409, json: { error: { message: 'Someone else changed this list. Reload before saving.' } } });
      saved = { ...route.request().postDataJSON(), revision: '2026-10-05T00:00:01.000Z' };
      return route.fulfill({ json: { data: saved } });
    });
    const open = () => page.goto(`http://127.0.0.1:${server.address().port}`);
    await open(); await expect(page.getByRole('alert')).toContainText('could not be loaded');
    mode = 'success'; await page.getByRole('button', { name: 'Load recipients again' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Synthetic owner'); assert.equal(writes, 0);
    await page.getByRole('button', { name: 'Add recipient' }).click();
    const second = page.getByRole('region', { name: 'Recipient 2' });
    await second.getByLabel('Name', { exact: true }).fill('Synthetic responder');
    await second.getByLabel('Email address').fill('second@example.invalid');
    await page.getByRole('button', { name: 'Save recipients' }).click();
    await expect(page.getByRole('alert')).toContainText('permission'); assert.equal(writes, 0);
    await second.getByLabel('This person has agreed').check();
    mode = 'rejected'; await page.getByRole('button', { name: 'Save recipients' }).click();
    await expect(page.getByRole('alert')).toContainText('Synthetic validation'); await expect(second.getByLabel('Name', { exact: true })).toHaveValue('Synthetic responder');
    mode = 'success'; await page.getByRole('button', { name: 'Save recipients' }).click();
    await expect(page.getByRole('status')).toContainText('Recipients saved');
    await page.screenshot({ path: `output/operations-alert-recipients/recipients-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`);
    await second.getByLabel('Name', { exact: true }).fill('Changed');
    mode = 'uncertain'; const before = writes; await page.getByRole('button', { name: 'Save recipients' }).click();
    await expect(page.getByRole('alert')).toContainText('could not confirm');
    await expect(page.getByRole('button', { name: 'Save recipients' })).toBeDisabled(); assert.equal(writes, before + 1);
    mode = 'success'; await page.getByRole('button', { name: 'Reload saved list' }).click();
    await expect(second.getByLabel('Name', { exact: true })).toHaveValue('Synthetic responder'); assert.equal(writes, before + 1);
    await second.getByLabel('Name', { exact: true }).fill('Changed again'); mode = 'conflict';
    await page.getByRole('button', { name: 'Save recipients' }).click(); await expect(page.getByRole('button', { name: 'Reload saved list' })).toBeVisible();
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS alert recipients: add/channel/consent validation, save recovery, uncertain no-repeat, conflicting owner save and responsive layouts; all writes intercepted synthetic data only.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }

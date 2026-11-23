import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const bundle = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {WhatChimpRecipientForm} from "./src/components/whatchimp-recipient-form"; createRoot(document.getElementById("root")).render(<WhatChimpRecipientForm/>);', resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
const server = createServer((req, res) => { if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(readFileSync('src/app/globals.css')); } else if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); } else { res.setHeader('content-type', 'text/html'); res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><main class="page-stack"><div id="root"></div></main><script src="/fixture.js"></script>'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); let saved = null, fail = false;
  await page.route('**/api/v1/integrations/whatchimp-enquiry-recipient', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: { facilities: [{ id: 'f', name: 'Midpoint' }], users: [{ id: 'u', name: 'Recipient', email: 'staff@example.invalid' }], connections: [{ facilityId: 'f', recipientUserId: saved?.recipientUserId ?? null }] } } });
    if (fail) return route.fulfill({ status: 409 });
    saved = route.request().postDataJSON(); return route.fulfill({ json: { data: { configured: true } } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('select').first().selectOption('f');
  await page.locator('select').nth(1).selectOption('u');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'recipient form must not overflow');
    for (const field of await page.locator('select').all()) { const box = await field.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width); }
  }
  await page.getByRole('button', { name: 'Save recipient' }).click();
  await page.getByText('Recipient saved.').waitFor(); assert.deepEqual(saved, { facilityId: 'f', recipientUserId: 'u' });
  fail = true; await page.getByRole('button', { name: 'Save recipient' }).click();
  await page.getByText('Could not save. Check the facility and recipient permissions.').waitFor();
  console.log('PASS WhatsApp recipient selection, error handling and responsive layout');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

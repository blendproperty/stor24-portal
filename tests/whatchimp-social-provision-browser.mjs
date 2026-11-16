import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const bundle = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {SocialProvisionForm} from "./src/components/social-provision-form"; createRoot(document.getElementById("root")).render(<SocialProvisionForm/>);', resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
const server = createServer((req, res) => { if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end(readFileSync('src/app/globals.css')); } else if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); } else { res.setHeader('content-type', 'text/html'); res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><main class="page-stack"><h1>Facebook and Instagram enquiries</h1><div id="root"></div></main><script src="/fixture.js"></script>'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); let writes = 0, fail = false;
  await page.route('**/api/v1/integrations/whatchimp-social', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: { facilities: [{ id: 'f', name: 'Midpoint' }], users: [{ id: 'u', name: 'Recipient', email: 'staff@example.invalid' }], connections: [] } } });
    if (route.request().method() === 'POST') { writes++; const body = route.request().postDataJSON(); assert.equal(body.facilityId, 'f'); assert.equal(body.recipientEmail, 'staff@example.invalid'); if (fail) return route.fulfill({ status: 503, json: { error: { message: 'Unavailable' } } }); return route.fulfill({ json: { data: { facebook: 'facebook-fixture-key', instagram: 'instagram-fixture-key' } } }); }
    writes++; return route.fulfill({ json: { data: { revoked: true } } });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const labels = await page.locator('.social-provision-fields label').all();
    for (const label of labels) {
      const box = await label.boundingBox();
      const field = await label.locator('input,select').boundingBox();
      assert.ok(box && field && field.x >= box.x && field.x + field.width <= width && field.y > box.y, 'field must fit beneath its label');
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'page must not overflow horizontally');
    if (process.env.SOCIAL_LAYOUT_SCREENSHOTS) await page.screenshot({ path: `social-provision-${width}.png`, fullPage: true });
  }
  await page.getByLabel('Facility').selectOption('f'); await page.getByLabel('Notification recipient').selectOption('u');
  await page.getByLabel('Facebook bot ID').fill('123'); await page.getByLabel('Instagram bot ID').fill('456');
  await page.getByRole('button', { name: 'Create separate credentials' }).click();
  assert.equal(await page.getByLabel('Facebook key').inputValue(), 'facebook-fixture-key');
  assert.equal(await page.getByLabel('Instagram key').inputValue(), 'instagram-fixture-key'); assert.equal(writes, 1);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'key display must not overflow');
    if (process.env.SOCIAL_LAYOUT_SCREENSHOTS) await page.screenshot({ path: `social-provision-keys-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Done' }).click(); assert.equal(await page.getByLabel('Facebook key').count(), 0);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Revoke matching credentials' }).click();
  assert.equal(writes, 1);
  fail = true; await page.getByRole('button', { name: 'Create separate credentials' }).click();
  await page.getByText('The result is uncertain. Do not retry until the connections have been reviewed.').waitFor();
  console.log('PASS owner form keeps keys separate and does not revoke after cancellation');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
const source = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CustomerHistory}from'./src/components/customer-history';createRoot(document.getElementById('root')).render(<main style={{padding:20}}><CustomerHistory customerId="training-example"/></main>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic' });
const css = (await readFile('src/app/globals.css', 'utf8') + await readFile('src/styles/stor24-brand.css', 'utf8')).replace('@import "tailwindcss";', '') + 'body{margin:0;background:#fff;color:#173036;font-family:Arial,sans-serif}input,select,button,textarea{font:inherit}.customer-history{margin:0}';
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? source.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 768, height: 520 }, deviceScaleFactor: 1.5 });
  await page.route('**/api/v1/customers/*/history**', route => route.fulfill({ json: { data: { entries: [{ id: 'example', kind: 'NOTE', at: '2026-10-14T09:30:00Z', title: 'Staff handover', body: 'Training example: customer agreed to a call before the weekend arrival. Review the appointment and current readiness.', category: 'HANDOVER', author: 'Example staff member', facility: 'Midpoint (training example)', channel: null, status: null, sentAt: null, deliveredAt: null, readAt: null }], nextCursor: null, facilities: [{ id: 'example', name: 'Midpoint (training example)' }], writableFacilities: [{ id: 'example', name: 'Midpoint (training example)' }], visibility: { communications: true, collections: true, accounts: false }, legacyNotes: null, canExport: true } } }));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole('heading', { name: 'Staff handover', exact: true })).toBeVisible();
  await mkdir('docs/assets/staff-handbook', { recursive: true });
  await page.screenshot({ path: 'docs/assets/staff-handbook/customer-history.png' });
  await page.getByText('Date and communication filters', { exact: true }).click();
  await page.getByLabel('From date (SAST)').fill('2026-10-01'); await page.getByLabel('To date (SAST)').fill('2026-10-14');
  await page.getByLabel('Communication channel').selectOption('WHATSAPP');
  await page.getByRole('heading', {name:'Customer history & staff notes',exact:true}).click();
  await page.locator('.customer-history > form.customer-history-filters').screenshot({ path: 'docs/assets/staff-handbook/history-download-filters.png' });
  console.log('Rendered actual history component with clearly labelled synthetic training data; no production record or action.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

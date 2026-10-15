import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const state = { failed: false, data: { scanned: 100, nextCursor: 'older-payment', rows: [{ id: 'cm000000000000000000000000000000000000001', accountId: 'account', customerId: 'customer', customer: 'Alex Example', facilityId: 'store-a', facility: 'Midpoint', reason: 'AWAITING_CONFIRMATION', amount: '100.00', currency: 'ZAR', createdAt: '2026-10-14T09:00:00.000Z', provider: 'NETCASH', href: '/billing/netcash?facilityId=store-a' }] } };
const bundle = await build({ entryPoints: ['src/app/operations/payment-review/page.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', plugins: [{ name: 'source-fixture', setup(b) {
  b.onResolve({ filter: /^(next\/link|@\/lib\/(scope|staff-payment-review-service))$/ }, a => ({ path: a.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'next/link' ? "import React from 'react';export default function Link(p){return React.createElement('a',p)}" : a.path.endsWith('/scope') ? 'export const requirePermissionScope=async()=>({});' : 'export const staffPaymentReviewQueue=async()=>{if(__state.failed)throw Error("SOURCE_UNAVAILABLE");return __state.data;};', loader: 'jsx', resolveDir: process.cwd() }));
} }] });
const loaded = { exports: {} }; new Function('require', 'module', 'exports', '__state', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, state);
const css = (await Promise.all(['src/app/globals.css', 'src/styles/stor24-brand.css', 'src/styles/staff-workspace.css'].map(p => readFile(p, 'utf8')))).join('\n').replace('@import "tailwindcss";', '') + '\nbody{font-family:Arial,sans-serif;margin:0;background:#eff4f7}main{padding:20px;max-width:1440px;margin:auto}';
const render = async () => `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main>${renderToStaticMarkup(await loaded.exports.default({ searchParams: Promise.resolve({ facilityId: 'store-a' }) }))}</main>`;
const browser = await chromium.launch(); await mkdir('output/staff-attention', { recursive: true });
try {
  const page = await browser.newPage();
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); state.failed = false;
    await page.setContent(await render());
    await expect(page.getByText('Alex Example · Awaiting confirmation', { exact: true })).toBeVisible();
    assert.equal(await page.getByRole('link', { name: /Review source/ }).getAttribute('href'), '/billing/netcash?facilityId=store-a');
    assert.ok((await page.getByRole('link', { name: 'Review older payments' }).getAttribute('href')).includes('facilityId=store-a&cursor=older-payment'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px payment queue overflow`);
    assert.ok(await page.locator('.payment-review-panel .work-copy').evaluate(e => e.getBoundingClientRect().width > 160), `${width}px payment copy must retain a readable column width`);
    await page.screenshot({ path: `output/staff-attention/payments-${width}.png`, fullPage: true });
    state.failed = true; await page.setContent(await render());
    await expect(page.getByRole('alert')).toContainText('could not be loaded'); await expect(page.getByText(/No unresolved payments/)).toHaveCount(0);
    console.log(`PASS ${width}px actual server payment queue, source links, complete older-page link and unavailable-source state`);
  }
} finally { await browser.close(); }

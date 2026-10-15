import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const policy = await build({ entryPoints: ['src/lib/staff-attention-policy.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { arrivalChangeSchema, eventAcknowledgeSchema } = await import('data:text/javascript;base64,' + Buffer.from(policy.outputFiles[0].text).toString('base64'));
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{StaffArrivals,StaffEventInbox}from'./src/components/staff-attention-workspace';createRoot(document.getElementById('root')).render(location.pathname==='/events'?<StaffEventInbox/>:<StaffArrivals initialFrom="2026-10-17" initialTo="2026-10-18"/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', plugins: [{ name: 'next-link', setup(b) { b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: 'jsx', resolveDir: process.cwd() })); } }] });
const css = (await Promise.all(['src/app/globals.css', 'src/styles/stor24-brand.css', 'src/styles/staff-workspace.css'].map(p => readFile(p, 'utf8')))).join('\n').replace('@import "tailwindcss";', '') + '\nbody{font-family:Arial,sans-serif;margin:0;background:#eff4f7}#root{padding:20px;max-width:1440px;margin:auto}';
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(); await mkdir('output/staff-attention', { recursive: true });
const store = { id: 'cm00000000000000000000001', name: 'Midpoint' }, manager = { id: 'cm00000000000000000000002', name: 'Responsible staff' }, cover = { id: 'cm00000000000000000000003', name: 'Weekend cover' };
try {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let mode = 'success', managerView = true, mutationCount = 0;
    const row = { id: 'cm00000000000000000000004', customerId: 'synthetic-customer', customer: 'Alex Example', facilityId: store.id, facility: store.name, unit: '106', intendedMoveIn: '2026-10-16T22:00:00.000Z', sourceHash: 'a'.repeat(64), readiness: { signed: true, paymentVerified: false, testPayment: true, readyNow: false, blockers: ['A test payment does not clear the real booking for key collection.', 'Key collection starts on 2026-10-17.'] }, handover: null };
    const event = { id: 'synthetic-booking', kind: 'BOOKING', sourceKey: 'BOOKING:synthetic-booking', sourceHash: 'a'.repeat(64), at: '2026-10-14T09:00:00.000Z', customer: 'Alex Example', customerId: row.customerId, facilityId: store.id, facility: store.name, unit: '106', href: '/tenants?customer=synthetic-customer', acknowledgedAt: null };
    await page.route('**/api/v1/operations/**', async route => {
      const request = route.request(), isEvents = request.url().includes('/events');
      if (request.method() === 'GET') {
        if (mode === 'denied') return route.fulfill({ status: 403, json: { error: {} } });
        if (mode === 'read-failure') return route.fulfill({ status: 503, json: { error: {} } });
        if (mode === 'malformed') return route.fulfill({ json: { data: {} } });
        return route.fulfill({ json: { data: isEvents ? { nextCursor: null, events: [event] } : { nextCursor: null, userId: managerView ? manager.id : cover.id, undated: 1, manageableFacilityIds: managerView ? [store.id] : [], query: { from: '2026-10-17', to: '2026-10-18' }, facilities: [store], staff: [manager, cover].map(s => ({ ...s, facilityIds: [store.id] })), rows: [row] } } });
      }
      const body = request.postDataJSON(); mutationCount++;
      assert.ok((isEvents ? eventAcknowledgeSchema : arrivalChangeSchema).safeParse(body).success);
      if (mode === 'conflict') return route.fulfill({ status: 409, json: { error: {} } });
      if (isEvents) event.acknowledgedAt = '2026-10-15T07:00:00.000Z';
      else if (body.action === 'ASSIGN') row.handover = { id: 'synthetic-handover', revision: 0, notes: body.notes, owner: manager, cover, coverAvailable: true, sourceCurrent: true, coverAcknowledgedAt: null };
      else row.handover = { ...row.handover, revision: row.handover.revision + 1, coverAcknowledgedAt: '2026-10-15T07:00:00.000Z' };
      if (mode === 'uncertain') return route.abort();
      return route.fulfill({ json: { data: { id: 'synthetic-saved-record' } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/arrivals`);
    await expect(page.getByRole('heading', { name: 'Expected arrivals', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Arrival plan & cover', exact: true })).toBeVisible();
    await expect(page.getByText('Not ready for key handover now', { exact: true })).toBeVisible();
    await expect(page.getByText(/have no agreed arrival date/)).toBeVisible();
    await page.getByRole('button', { name: 'Assign or update cover' }).click();
    await page.getByLabel('Responsible staff for Unit 106', { exact: true }).selectOption(manager.id);
    await page.getByLabel('Covering staff for Unit 106', { exact: true }).selectOption(cover.id);
    await page.getByLabel('Arrival handover notes for Unit 106').fill('Saturday arrival. Read the payment and identity checks before keys.');
    await page.getByRole('button', { name: 'Save arrival handover' }).click();
    await expect(page.getByText('Saturday arrival. Read the payment and identity checks before keys.', { exact: true })).toBeVisible();
    assert.equal(mutationCount, 1);
    await page.screenshot({ path: `output/staff-attention/arrivals-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px arrivals overflow`);
    managerView = false; await page.getByRole('button', { name: 'Reload arrivals' }).click();
    await expect(page.getByRole('button', { name: 'Assign or update cover' })).toHaveCount(0);
    mode = 'conflict'; await page.getByRole('button', { name: 'Acknowledge arrival cover' }).click(); await expect(page.getByRole('alert')).toContainText('changed');
    mode = 'success'; await page.getByRole('button', { name: 'Reload arrivals' }).click();
    mode = 'uncertain'; await page.getByRole('button', { name: 'Acknowledge arrival cover' }).click(); await expect(page.getByRole('alert')).toContainText('could not confirm'); await expect(page.getByRole('button', { name: 'Acknowledge arrival cover' })).toBeDisabled();
    mode = 'read-failure'; await page.getByRole('button', { name: 'Reload arrivals' }).click(); await expect(page.getByRole('alert')).toBeVisible();
    mode = 'success'; await page.getByRole('button', { name: 'Reload arrivals' }).click(); await expect(page.getByText(/Cover acknowledged/)).toBeVisible();
    mode = 'denied'; await page.getByRole('button', { name: 'Reload arrivals' }).click(); await expect(page.getByText('Alex Example · Unit 106', { exact: true })).toHaveCount(0);
    mode = 'success'; await page.goto(`http://127.0.0.1:${server.address().port}/events`);
    await expect(page.getByRole('heading', { name: 'Booking & move-in events', exact: true })).toBeVisible();
    await page.screenshot({ path: `output/staff-attention/events-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px inbox overflow`);
    mode = 'uncertain'; await page.getByRole('button', { name: 'Mark booking created as read' }).click(); await expect(page.getByRole('alert')).toContainText('could not confirm');
    mode = 'malformed'; await page.getByRole('button', { name: 'Reload events' }).click(); await expect(page.getByRole('alert')).toContainText('incomplete'); await expect(page.getByRole('button', { name: 'Mark booking created as read' })).toBeDisabled();
    mode = 'success'; await page.getByRole('button', { name: 'Reload events' }).click(); await expect(page.getByText('0 unread events on this page.', { exact: true })).toBeVisible();
    mode = 'denied'; await page.getByRole('button', { name: 'Reload events' }).click(); await expect(page.getByText('Booking created', { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []); await page.close(); console.log(`PASS ${width}px arrival assignment/cover, stale-source conflict, uncertain save, access removal and personal inbox recovery`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

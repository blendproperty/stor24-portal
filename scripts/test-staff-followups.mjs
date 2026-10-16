import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const policy = await build({ entryPoints: ['src/lib/staff-followup-policy.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { staffFollowupSchema, staffFollowupChangeSchema } = await import('data:text/javascript;base64,' + Buffer.from(policy.outputFiles[0].text).toString('base64'));
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{StaffFollowups}from'./src/components/staff-followups';createRoot(document.getElementById('root')).render(<StaffFollowups/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', plugins: [{ name: 'next-link', setup(b) { b.onResolve({ filter: /^next\/link$/ }, a => ({ path: a.path, namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react';export default function Link(p){return React.createElement('a',p)}", loader: 'jsx', resolveDir: process.cwd() })); } }] });
const css = (await Promise.all(['src/app/globals.css', 'src/styles/stor24-brand.css', 'src/styles/staff-workspace.css'].map(p => readFile(p, 'utf8')))).join('\n').replace('@import "tailwindcss";', '') + '\nbody{font-family:Arial,sans-serif;margin:0;background:#eff4f7}#root{padding:20px;max-width:1440px;margin:auto}';
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? bundle.outputFiles[0].text : `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(); await mkdir('output/staff-followups', { recursive: true });
const ids = ['cm00000000000000000000001', 'cm00000000000000000000002', 'cm00000000000000000000003', 'cm00000000000000000000004'];
const customer = { id: ids[1], firstName: 'Alex', lastName: 'Example', companyName: null };
const responsible = { id: ids[2], name: 'Responsible staff' }, cover = { id: ids[3], name: 'Weekend cover' };
try {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let mode = 'success', tasks = [], created = [], changes = [], canManage = true;
    await page.route('**/api/v1/operations/followups**', async route => {
      const request = route.request();
      if (request.method() === 'GET') {
        if (mode === 'denied') return route.fulfill({ status: 403, json: { error: {} } });
        if (mode === 'read-failure') return route.fulfill({ status: 503, json: { error: {} } });
        return route.fulfill({ json: { data: { userId: canManage ? responsible.id : cover.id, canManage, tasks, nextCursor: null, facilities: [{ id: ids[0], name: 'Midpoint' }], customers: new URL(request.url()).searchParams.get('search') ? [customer] : [], staff: [responsible, cover].map(s => ({ ...s, facilityIds: [ids[0]] })) } } });
      }
      const body = request.postDataJSON();
      if (request.method() === 'POST') {
        assert.ok(staffFollowupSchema.safeParse(body).success);
        created.push(body);
        tasks = [{ id: 'synthetic-appointment', ...body, updatedAt: '2026-10-14T06:00:00.000Z', status: 'OPEN', coverAcknowledgedAt: null, customer, facility: { id: ids[0], name: 'Midpoint' }, assignee: responsible, cover }];
      } else {
        assert.ok(staffFollowupChangeSchema.safeParse(body).success); changes.push(body);
        if (mode === 'conflict') return route.fulfill({ status: 409, json: { error: {} } });
        if (body.action === 'UPDATE') tasks[0] = { ...tasks[0], title: body.title, description: body.description, dueAt: body.dueAt, assignee: [responsible, cover].find(s => s.id === body.assigneeId), cover: [responsible, cover].find(s => s.id === body.coverId) ?? null, updatedAt: '2026-10-14T06:05:00.000Z' };
        if (body.action === 'ACKNOWLEDGE') tasks[0] = { ...tasks[0], coverAcknowledgedAt: '2026-10-14T06:10:00.000Z', updatedAt: '2026-10-14T06:10:00.000Z' };
      }
      if (mode === 'uncertain') return route.abort();
      return route.fulfill({ json: { data: { id: 'synthetic-appointment' } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole('heading', { name: 'Follow-ups & handovers' })).toBeVisible();
    await page.getByRole('button', { name: 'Schedule follow-up', exact: true }).click();
    await page.getByLabel('Find customer by name').fill('Alex'); await page.getByRole('button', { name: 'Search customers' }).click();
    await page.getByLabel('Customer', { exact: true }).selectOption(customer.id);
    await page.getByLabel('Responsible staff', { exact: true }).selectOption(responsible.id);
    await page.getByLabel('Covering staff', { exact: true }).selectOption(cover.id);
    await page.getByLabel('Agreed date and time (SAST)').fill('2026-10-14T09:00');
    await page.getByLabel('Appointment title').fill('Agreed advance call');
    await page.getByLabel('Agreed action and handover details').fill('Customer agreed to call on 14th. Promise due 15th remains held.');
    await page.getByRole('button', { name: 'Save agreed appointment' }).click();
    await expect(page.getByRole('button', { name: 'Complete', exact: true })).toBeVisible();
    assert.equal(created.length, 1); assert.equal(created[0].dueAt, '2026-10-14T07:00:00.000Z');
    assert.ok(await page.getByRole('link', { name: /Customer history/ }).getAttribute('href').then(s => s.includes(customer.id)));
    await page.screenshot({ path: `output/staff-followups/${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`);
    await page.getByLabel('Appointment queue').selectOption('due');
    await expect(page.getByRole('heading', { name: 'Due today & overdue', exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('view'), 'due');
    await page.getByRole('button', { name: 'Edit appointment', exact: true }).click();
    const edit = page.getByRole('form', { name: 'Edit Agreed advance call' });
    await expect(edit.getByLabel('Agreed date and time (SAST)')).toHaveValue('2026-10-14T09:00');
    await edit.getByLabel('Agreed date and time (SAST)').fill('2026-10-14T10:30');
    await edit.getByLabel('Agreed action and handover details').fill('Customer agreed to a later call. Payment promise unchanged.');
    await edit.getByRole('button', { name: 'Save appointment changes' }).click();
    await expect(edit).toHaveCount(0);
    assert.equal(changes.at(-1).action, 'UPDATE');
    assert.equal(changes.at(-1).dueAt, '2026-10-14T08:30:00.000Z');
    assert.equal(changes.at(-1).expectedUpdatedAt, '2026-10-14T06:00:00.000Z');
    mode = 'conflict'; await page.getByRole('button', { name: 'Complete', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('changed');
    mode = 'success'; canManage = false; await page.getByRole('button', { name: 'Reload follow-ups' }).click();
    await expect(page.getByRole('button', { name: 'Acknowledge cover' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Complete', exact: true })).toHaveCount(0);
    mode = 'uncertain'; await page.getByRole('button', { name: 'Acknowledge cover' }).click(); await expect(page.getByRole('alert')).toContainText('could not confirm');
    await expect(page.getByRole('button', { name: 'Acknowledge cover' })).toBeDisabled();
    mode = 'read-failure'; await page.getByRole('button', { name: 'Reload follow-ups' }).click(); await expect(page.getByRole('alert')).toBeVisible();
    mode = 'success'; await page.getByRole('button', { name: 'Reload follow-ups' }).click(); await expect(page.getByText(/Acknowledged/)).toBeVisible();
    mode = 'denied'; await page.getByRole('button', { name: 'Reload follow-ups' }).click(); await expect(page.getByText('Agreed advance call', { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []); await page.close(); console.log(`PASS ${width}px actual follow-up creation, SAST, named cover, conflict, uncertain save/read recovery and access removal`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { get } from 'node:http';
import { chromium, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:3109';
function localResponse(path) {
  const url = new URL(path, origin); assert.equal(url.origin, origin);
  return new Promise((resolve, reject) => {
    const request = get(url, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, policy: response.headers['content-security-policy'], text: Buffer.concat(chunks).toString() })); });
    request.setTimeout(5000, () => request.destroy(new Error('Loopback test server timed out.')));
    request.on('error', reject);
  });
}
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3109'], { env: { ...process.env, NODE_ENV: 'production', AUTH_SECRET: randomBytes(32).toString('hex'), DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/xss_ci' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', chunk => logs += chunk); server.stderr.on('data', chunk => logs += chunk);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await localResponse('/login')).status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.ok(ready, logs);
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const payload = '</script><img src=x onerror="globalThis.xssExecuted=1">';
    const response = await page.goto(origin + '/login?next=' + encodeURIComponent(payload));
    assert.equal(response.status(), 200);
    const policy = response.headers()['content-security-policy'], nonce = policy.match(/'nonce-([^']+)'/)?.[1]; assert.ok(nonce);
    assert.ok(!policy.split(';').find(part => part.trim().startsWith('script-src ')).includes('unsafe-inline'));
    assert.equal(await page.locator('script').evaluateAll((nodes, value) => nodes.every(node => node.nonce === value), nonce), true);
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(page.locator('input[name=password]')).toHaveAttribute('type', 'text');
    await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.locator('input[name=email]')).toBeVisible();
    await page.evaluate(() => { const script = document.createElement('script'); script.textContent = 'globalThis.xssExecuted=1'; document.body.append(script); const img = document.createElement('img'); img.setAttribute('onerror', 'globalThis.xssExecuted=1'); img.src = '/brand/missing-xss-image'; document.body.append(img); });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => globalThis.xssExecuted || false), false);
    assert.deepEqual(errors, []);
    await page.close();

    // Actual encrypted IndexedDB -> unlock -> offline HTML sinks, with synthetic stored data.
    const offlinePage = await browser.newPage({ viewport: { width, height: 900 } });
    await offlinePage.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
    await offlinePage.goto(origin + '/offline-workspace.html');
    await offlinePage.evaluate(async value => {
      const id = '" onclick="globalThis.xssExecuted=1', now = new Date().toISOString(), expiresAt = new Date(Date.now() + 3600000).toISOString();
      const snapshot = { generatedAt: now, expiresAt, revision: 'synthetic', facility: { id, name: value }, units: [{ id, number: value, status: 'AVAILABLE', monthlyRate: 100, unitType: { id, name: value } }], leads: [], reservations: [], tasks: [], outbox: [{ submissionId: id, firstName: value, lastName: 'Synthetic', status: 'WAITING', capturedAt: now }], reservationOutbox: [{ submissionId: id, unitId: id, status: 'CONFLICT', quotedRate: 100, capturedAt: now }], syncReceipts: [{ leadId: value, syncedAt: now, nextActions: { openLeadUrl: 'java\tscript:globalThis.xssExecuted=1' } }], reservationReceipts: [{ reference: value, syncedAt: now, nextActions: { openReservationUrl: 'https://outside.invalid/', continueToLeaseUrl: '/operations/move-in?reservation=synthetic' } }] };
      const enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      const material = await crypto.subtle.importKey('raw', enc.encode('synthetic-offline-passphrase'), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(snapshot)));
      const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
      await new Promise((resolve, reject) => { const request = indexedDB.open('stor24-offline-pilot', 1); request.onupgradeneeded = () => request.result.createObjectStore('encrypted-snapshot'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('encrypted-snapshot', 'readwrite'); tx.objectStore('encrypted-snapshot').put({ version: 2, salt: base64(salt), iv: base64(iv), ciphertext: base64(cipher), facilityId: id, facilityName: value, expiresAt, deviceId: 'synthetic' }, 'current'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
    }, payload);
    await offlinePage.reload();
    await offlinePage.locator('#unlock-passphrase').fill('synthetic-offline-passphrase');
    await offlinePage.locator('#unlock').click();
    await expect(offlinePage.locator('#workspace')).toBeVisible();
    await expect(offlinePage.locator('#facility-name')).toHaveText(payload);
    assert.equal(await offlinePage.locator('#workspace [onclick],#workspace [onerror],#workspace script,#workspace img').count(), 0);
    assert.equal(await offlinePage.locator('#sync-receipts a').evaluateAll(nodes => nodes.every(node => node.origin === location.origin && ['/leads', '/operations/move-in'].includes(node.pathname))), true);
    assert.equal(await offlinePage.evaluate(() => globalThis.xssExecuted || false), false);
    await offlinePage.close();
  }
  const first = await localResponse('/login'), second = await localResponse('/login');
  assert.notEqual(first.policy, second.policy);
  const offline = await localResponse('/offline.html');
  assert.doesNotMatch(offline.text, /onclick=|<script>/);
  assert.equal((await localResponse('/offline-recovery.js')).status, 200);
  console.log('PASS CRM production stored encrypted-offline/reflected/DOM XSS, nonce freshness, hydrated login/navigation and external offline recovery at 1440/390');
} finally { await browser?.close(); server.kill(); }

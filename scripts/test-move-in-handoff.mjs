// Local-only, synthetic account data. All API requests are intercepted; no email or photo is sent.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.TENANT_TEST_ORIGIN || "http://localhost:3041";
if (new URL(base).hostname !== "localhost") throw new Error("Local fixture only");
const browser = await chromium.launch();
await mkdir("output/photo-handoff", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let signedIn = false;
    const photoReads = [], unexpectedWrites = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const units = [1, 2].map(number => ({ key:`reservation:booking-${number}`, unitId:`unit-${number}`, number:String(number), facilityName:"Training store", accountId:null, status:"ACTIVE", accessState:"NOT_ACTIVATED", reservations:[{ id:`booking-${number}`, publicReference:`ST24-PREVIEW-${number}`, packageSelection:null }] }));
    const data = { accounts:[], units, onboarding:[], documents:[], agreements:[], payments:[], merchandiseRequests:[], expiresAt:new Date(Date.now()+1800000).toISOString() };
    await page.route("**/api/**", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith('/auth/start')) return route.fulfill({json:{message:'Preview only. No email sent.'}});
      if (url.pathname.endsWith('/auth/verify')) { signedIn=true; return route.fulfill({json:{ok:true}}); }
      if (request.method() !== 'GET') unexpectedWrites.push(url.pathname);
      if (!signedIn) return route.fulfill({status:401,json:{error:'Sign in again.'}});
      if (url.pathname === '/api/tenant/accounts') return route.fulfill({json:{data}});
      if (url.pathname === '/api/tenant/access-photo') { photoReads.push(url.searchParams.get('reservationId')); return route.fulfill({json:{data:{available:false,policy:null,photo:null}}}); }
      if (url.pathname === '/api/tenant/merchandise') return route.fulfill({json:{data:{products:[]}}});
      return route.fulfill({status:404,json:{error:'Local fixture only'}});
    });
    await page.goto(`${base}/my?organisation=preview&booking=ST24-PREVIEW-2&step=access-photo`);
    await expect(page.getByRole('heading',{name:'Let’s get you move-in ready.'})).toBeVisible();
    await page.getByLabel('Email on your STOR24 account').fill('preview@example.invalid');
    await page.getByRole('button',{name:'Email me a sign-in code'}).click();
    await page.getByLabel('Your six-digit code').fill('123456');
    await page.getByRole('button',{name:'Open my account'}).click();
    await expect(page.getByLabel('My units')).toHaveValue('reservation:booking-2');
    await expect(page.locator('#access-photo')).toBeFocused();
    await expect(page.getByText('Photo collection isn’t open yet')).toBeVisible();
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    assert.deepEqual(photoReads,['booking-2']);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`output/photo-handoff/portal-${width}.png`,fullPage:true});
    photoReads.length=0;
    await page.goto(`${base}/my?organisation=preview&booking=NOT-THIS-CUSTOMER&step=access-photo`);
    await expect(page.getByText('We couldn’t match this booking',{exact:false})).toBeVisible();
    await expect(page.locator('#access-photo')).toHaveCount(0);
    assert.deepEqual(photoReads,[]);
    await page.getByLabel('My units').selectOption('reservation:booking-1');
    await expect(page.locator('#access-photo')).toBeFocused();
    await expect(page.getByText('Photo collection isn’t open yet')).toBeVisible();
    assert.deepEqual(photoReads,['booking-1']);
    assert.deepEqual(unexpectedWrites,[]); assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: booking survives sign-in, correct authorised unit selected, photo focus, legal hold, unknown booking recovery, mobile bounds; mocked APIs only.');
} finally { await browser.close(); }

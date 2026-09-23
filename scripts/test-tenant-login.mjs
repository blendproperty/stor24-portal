// Actual login component with intercepted synthetic APIs: no email delivery.
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle=await build({entryPoints:["tests/browser/tenant-login-fixture.jsx"],bundle:true,define:{"process.env":"{}"},write:false,loader:{".css":"empty"},format:"esm",jsx:"automatic"});
const css=await readFile("src/styles/facial-access.css","utf8")+await readFile("src/styles/tenant-portal.css","utf8");
const server=createServer(async(req,res)=>{
 if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");return res.end(bundle.outputFiles[0].text);}
 const url=new URL(req.url,"http://localhost");
 const asset=url.pathname==="/_next/image" ? url.searchParams.get("url") : url.pathname;
 if(asset?.startsWith("/brand/") && !asset.includes("..")){try{res.setHeader("Content-Type",asset.endsWith(".svg")?"image/svg+xml":"image/png");return res.end(await readFile(`public${asset}`));}catch{res.statusCode=404;return res.end();}}

 res.setHeader("Content-Type","text/html");res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${css}.tenant-email-help{margin:0;font-size:13px;color:#52615b}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch();await mkdir("output/email-prefill",{recursive:true});
try {
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}), starts=[], errors=[];
  page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
  await page.route("**/api/**",route=>{
   if(route.request().url().endsWith("/auth/start")){starts.push(route.request().postDataJSON());return route.fulfill({json:{message:"Synthetic only"}});}
   assert.equal(route.request().method(),"GET");
   return route.fulfill({status:401,json:{error:"Sign in"}});
  });
  const base=`http://127.0.0.1:${server.address().port}/my?booking=ST24-PREVIEW&step=access-photo`;
  await page.goto(base+"#email=person%2Bbooking%40example.invalid");
  const input=page.getByLabel("Email on your STOR24 account");
  await expect(input).toHaveValue("person+booking@example.invalid");await expect(input).toBeEditable();
  assert.equal(page.url(),base);assert.equal(starts.length,0);
  await page.screenshot({path:`output/email-prefill/login-${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await input.fill("changed@example.invalid");await page.getByRole("button",{name:"Email me a sign-in code"}).click();
  await expect(input).toBeDisabled();assert.equal(starts[0].email,"changed@example.invalid");
  await page.getByLabel("Your six-digit code").fill("123456");
  await page.getByRole("button",{name:"Use another email / request a new code"}).click();
  await expect(input).toBeEditable();await expect(page.getByLabel("Your six-digit code")).toHaveCount(0);
  await input.fill("second@example.invalid");await page.getByRole("button",{name:"Email me a sign-in code"}).click();
  await expect(page.getByLabel("Your six-digit code")).toHaveValue("");assert.equal(starts[1].email,"second@example.invalid");
  await page.goto(base+"&case=invalid#email=invalid");await expect(input).toHaveValue("");assert.equal(page.url(),base+"&case=invalid");
  await page.goto(base);await expect(input).toHaveValue("");assert.equal(starts.length,2);assert.deepEqual(errors,[]);
  await page.close();
 }

 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:1100}}), errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  let accessState="PENDING";
  const reservation={id:"booking-preview",publicReference:"ST24-PREVIEW",packageSelection:null};
  await page.route("**/api/**",route=>{
   assert.equal(route.request().method(),"GET","move-in review must not create an operational write");
   if(route.request().url().includes("/access-photo"))return route.fulfill({json:{data:{available:false,policy:null,photo:null}}});
   return route.fulfill({json:{data:{accounts:[],documents:[],agreements:[],payments:[],merchandiseRequests:[],expiresAt:new Date(Date.now()+1800000).toISOString(),units:[{key:"reservation:booking-preview",unitId:"unit-preview",number:"168",facilityName:"Training store",accountId:null,status:"ACTIVE",accessState,reservations:[reservation]}],onboarding:[{reservationId:reservation.id,ready:false,paidAmount:0,requiredAmount:2099,startDate:"2026-09-30",mandateStatus:null,blockers:["The identity document needs staff acceptance before key handover. Open Identity review.","A test payment is recorded. It does not clear the real booking for key collection."]}]}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/my`);
  const moveIn=page.getByRole("region",{name:"Your move-in",exact:true});
  await expect(moveIn).toHaveCount(1);
  await expect(moveIn.getByText("Photo collection isn’t open yet",{exact:true})).toBeVisible();
  await expect(moveIn.getByText("Your photo will be uploaded and added",{exact:false})).toBeVisible();
  await expect(moveIn.getByText("Not yet active.",{exact:false})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Facial access",exact:true})).toHaveCount(0);
  await expect(page.getByText("Facial access is confirmed separately.",{exact:false})).toHaveCount(0);
  await expect(page.getByText("Open Identity review.",{exact:false})).toHaveCount(0);
  await expect(moveIn.getByText("A test payment is recorded.",{exact:false})).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await moveIn.screenshot({path:`output/email-prefill/move-in-${width}.png`});
  accessState="ACTIVE";await page.reload();await expect(moveIn.getByText("Recorded as active.",{exact:false})).toBeVisible();
  accessState="REVOKED";await page.reload();await expect(moveIn.getByText("Not active. Contact your store",{exact:false})).toBeVisible();
  assert.deepEqual(errors,[]);await page.close();
 }

 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:1100}}), errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  let identityStatus="AWAITING_REVIEW", reviewRequired=false, packageStatus="RESERVED";
  const reservation={id:"booking-preview",publicReference:"ST24-PREVIEW",packageSelection:{packageName:"Compact Move",status:"RESERVED",priceSnapshot:"1099.00",itemsSnapshot:[{name:"Medium Moving Box",quantity:10}],fulfilledAt:null}};
  const account={id:"account-preview",accountNumber:"TEST-ACCOUNT",balance:"0.00",currency:"ZAR",tenancy:null};
  await page.route("**/api/**",route=>{
   assert.equal(route.request().method(),"GET","customer status checks must not change bookings or send messages");
   const path=new URL(route.request().url()).pathname;
   if(path.includes("/access-photo"))return route.fulfill({json:{data:{available:false,policy:null,photo:null}}});
   if(path.endsWith("/statement"))return route.fulfill({json:{data:{accountNumber:account.accountNumber,currency:"ZAR",openingBalance:"0.00",closingBalance:"0.00",rows:[]}}});
   if(path.includes("/orders"))return route.fulfill({json:{data:[]}});
   assert.equal(path,"/api/tenant/accounts");
   return route.fulfill({json:{data:{accounts:[{...account,balance:reviewRequired?null:"0.00",financialReviewRequired:reviewRequired},{...account,id:"other",accountNumber:"OTHER"}],documents:[],agreements:[],payments:[],merchandiseRequests:[],expiresAt:new Date(Date.now()+1800000).toISOString(),testPayments:[{id:"test-payment",accountId:account.id,amount:"2199.00",currency:"ZAR",status:"TEST_SUCCEEDED"}],units:[{key:"reservation:booking-preview",unitId:"unit-preview",number:"55",facilityName:"Training store",accountId:account.id,status:"ACTIVE",reservations:[{...reservation,packageSelection:{...reservation.packageSelection,status:packageStatus},identityDocument:{status:identityStatus,acknowledgedAt:"2026-09-23T07:55:00Z",reviewedAt:null,retentionMode:"TENANCY",expiresAt:null}}]},{key:"reservation:other",unitId:"unit-other",number:"99",facilityName:"Training store",accountId:"other",status:"ACTIVE",reservations:[{id:"other-booking",publicReference:"ST24-OTHER",packageSelection:null,identityDocument:null}]}]}}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/my`);
  await expect(page.getByRole("heading",{name:"ID uploaded — pending verification",exact:true})).toBeVisible();
  await expect(page.getByText("Upload received",{exact:false})).toBeVisible();
  await expect(page.getByRole("article",{name:"Booking package Compact Move"})).toBeVisible();
  await expect(page.getByText("10 × Medium Moving Box",{exact:true})).toBeVisible();
  await expect(page.getByText("Test payment recorded. This selection is saved",{exact:false})).toBeVisible();
  await expect(page.getByText("You haven’t purchased any packing supplies",{exact:false})).toHaveCount(0);
  await expect(page.locator(".tenant-balance-panel")).toContainText("Test payments are excluded");
  await page.getByRole("button",{name:"View statement",exact:true}).click();
  await expect(page.locator("#tenant-statements")).toContainText("No real transactions in this period");
  await expect(page.locator("#tenant-statements")).toContainText("ID verification does not turn a test payment into a real receipt");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`output/email-prefill/booking-status-${width}.png`,fullPage:true});
  identityStatus="ACCEPTED";await page.getByRole("button",{name:"Refresh move-in status"}).click();await expect(page.getByRole("heading",{name:"ID verified",exact:true})).toBeVisible();
  identityStatus="REPLACEMENT_REQUIRED";await page.getByRole("button",{name:"Refresh move-in status"}).click();await expect(page.getByRole("heading",{name:"Replacement ID needed",exact:true})).toBeVisible();
  packageStatus="RELEASED";reviewRequired=true;await page.reload();await expect(page.getByText("Reservation released · items are no longer held",{exact:true})).toBeVisible();
  await expect(page.locator(".tenant-balance-panel strong")).toHaveText("Under review");
  await page.getByLabel("My units").selectOption("reservation:other");
  await expect(page.getByRole("heading",{name:"No ID upload recorded",exact:true})).toBeVisible();
  await expect(page.getByRole("article",{name:"Booking package Compact Move"})).toHaveCount(0);
  await expect(page.getByText("Test payments are excluded",{exact:false})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"Replacement ID needed",exact:true})).toHaveCount(0);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log("PASS customer UAT regressions at 1440/390/320px: visible package/items, test statement explanation, pending/accepted/replacement/missing identity, refresh, released package, hidden review balance and unit isolation; zero writes");
 console.log("PASS move-in: single section at desktop/390/320px, precinct purpose, held upload, staff-only link removed, payment blocker preserved, active/revoked states");
 console.log("PASS desktop/mobile: editable prefill, fragment removed, no automatic OTP, changed email payload, code reset, invalid/no hint and no overflow");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}

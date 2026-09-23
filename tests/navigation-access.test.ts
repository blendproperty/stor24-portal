import assert from "node:assert/strict";
import test from "node:test";
import { canVisit } from "../src/lib/navigation-access.ts";
import { proxy } from "../src/proxy.ts";
import { db } from "../src/lib/db.ts";
import { createSessionToken, sessionCookieName } from "../src/lib/session.ts";
import { NextRequest } from "next/server";

test("navigation follows grants and specific subpage rules, not job title", () => {
  const manager = { owner: false, permissions: ["operations.view", "payments.view"] };
  assert.equal(canVisit("/billing", manager), false);
  assert.equal(canVisit("/billing/monthly", manager), false);
  assert.equal(canVisit("/billing/netcash", manager), true);
  assert.equal(canVisit("/operations", manager), true);
  assert.equal(canVisit("/settings", manager), true);
  assert.equal(canVisit("/users", manager), false);
  assert.equal(canVisit("/billing", {owner:false,permissions:["billing.*"]}), true);
  assert.equal(canVisit("/billing", {owner:true,permissions:[]}), true);
});

test("restricted direct navigation redirects before rendering; APIs and current grants retain their own checks", async () => {
  process.env.AUTH_SECRET = "navigation-test-secret-only-12345678901234567890";
  const token = await createSessionToken({userId:"fixture",name:"Test",email:"test@example.invalid",role:"Organisation owner",sessionVersion:1});
  const original = db.user.findUnique;
  let grants = ["operations.view"];
  let active = true;
  // JWT intentionally says owner; navigation must use the current database assignments.
  db.user.findUnique = (async () => ({active,sessionVersion:1,roleAssignments:[{facilityId:"store",role:{name:"Facility manager",permissions:grants}}]})) as unknown as typeof original;
  const request = (path:string) => new NextRequest(`https://example.invalid${path}`,{headers:{cookie:`${sessionCookieName}=${token}`}});
  try {
    const denied = await proxy(request("/billing"));
    assert.equal(denied.status,307);
    assert.equal(denied.headers.get("location"),"https://example.invalid/access-restricted");
    assert.equal((await proxy(request("/access-restricted"))).status,200);
    assert.equal((await proxy(request("/api/v1/billing/monthly"))).status,200);
    grants = ["billing.view"];
    assert.equal((await proxy(request("/billing"))).status,200);
    active = false;
    assert.match((await proxy(request("/billing"))).headers.get("location")!, /\/login\?/);
  } finally { db.user.findUnique = original; }
});


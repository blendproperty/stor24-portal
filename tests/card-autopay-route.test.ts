import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/tenant/card-autopay/route";
test("card preparation defaults closed before parsing or authenticating a request", async () => {
  const previous=process.env.CARD_AUTOPAY_PREPARATION_ENABLED;delete process.env.CARD_AUTOPAY_PREPARATION_ENABLED;
  try {const r=await POST(new Request("https://portal.example.invalid/api/tenant/card-autopay",{method:"POST",body:"not json"}));assert.equal(r.status,404);assert.match(r.headers.get("cache-control")!,/private, no-store/);}finally{if(previous===undefined)delete process.env.CARD_AUTOPAY_PREPARATION_ENABLED;else process.env.CARD_AUTOPAY_PREPARATION_ENABLED=previous;}
});


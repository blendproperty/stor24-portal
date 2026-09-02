import assert from "node:assert/strict";
import test from "node:test";

import { buildValidateServiceKeyEnvelope, parseValidateServiceKeyResponse } from "../src/lib/integrations/netcash-configuration";

const input = {
  merchantAccount: "599990123456",
  accountServiceKey: "00000000-0000-4000-8000-000000000005",
  debitOrderServiceKey: "00000000-0000-4000-8000-000000000001",
  payNowServiceKey: "00000000-0000-4000-8000-000000000014",
};

test("Netcash validation envelope uses the documented SOAP endpoint and service IDs", () => {
  const xml = buildValidateServiceKeyEnvelope(input);
  assert.match(xml, /NIWS_Partner\/ValidateServiceKey/);
  assert.match(xml, /<t:MerchantAccount>599990123456<\/t:MerchantAccount>/);
  assert.deepEqual([...xml.matchAll(/<t:ServiceId>(\d+)<\/t:ServiceId>/g)].map((match) => match[1]), ["5", "1", "14"]);
  assert.doesNotMatch(xml, /api\.netcash\.co\.za\/inbound-payments/);
});

test("Netcash validation response requires explicit account and service statuses", () => {
  const xml = `<ValidateServiceKeyResponse><AccountStatus>001</AccountStatus><ServiceInfoResponseArray0><ServiceId>5</ServiceId><ServiceStatus>001</ServiceStatus></ServiceInfoResponseArray0><ServiceInfoResponseArray1><ServiceId>1</ServiceId><ServiceStatus>001</ServiceStatus></ServiceInfoResponseArray1><ServiceInfoResponseArray2><ServiceId>14</ServiceId><ServiceStatus>001</ServiceStatus></ServiceInfoResponseArray2></ValidateServiceKeyResponse>`;
  assert.deepEqual(parseValidateServiceKeyResponse(xml), { accountStatus: "001", services: [{ serviceId: "5", status: "001" }, { serviceId: "1", status: "001" }, { serviceId: "14", status: "001" }] });
  assert.throws(() => parseValidateServiceKeyResponse("<broken/>"), /NETCASH_RESPONSE_INVALID/);
});

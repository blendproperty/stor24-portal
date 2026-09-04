import assert from "node:assert/strict";
import test from "node:test";
import {
  buildValidateServiceKeyEnvelope,
  describeNetcashStatus,
  parseValidateServiceKeyResponse,
  summariseNetcashValidation,
  validateNetcashServiceKeys,
} from "../src/lib/integrations/netcash-configuration";
const input = {
  merchantAccount: "51005101234",
  accountServiceKey: "00000000-0000-4000-8000-000000000005",
  debitOrderServiceKey: "00000000-0000-4000-8000-000000000001",
  payNowServiceKey: "00000000-0000-4000-8000-000000000014",
};
function responseXml(accountStatus: string, accountServices = "001", debitOrders = "001", payNow = "001") {
  return `<ValidateServiceKeyResponse><AccountStatus>${accountStatus}</AccountStatus><ServiceInfoResponseArray0><ServiceId>5</ServiceId><ServiceStatus>${accountServices}</ServiceStatus></ServiceInfoResponseArray0><ServiceInfoResponseArray1><ServiceId>1</ServiceId><ServiceStatus>${debitOrders}</ServiceStatus></ServiceInfoResponseArray1><ServiceInfoResponseArray2><ServiceId>14</ServiceId><ServiceStatus>${payNow}</ServiceStatus></ServiceInfoResponseArray2></ValidateServiceKeyResponse>`;
}
test("Netcash validation envelope uses the documented SOAP endpoint and service IDs", () => {
  const xml = buildValidateServiceKeyEnvelope(input);
  assert.match(xml, /NIWS_Partner\/ValidateServiceKey/);
  assert.match(xml, /<nc:MerchantAccount>51005101234<\/nc:MerchantAccount>/);
  assert.deepEqual([...xml.matchAll(/<nc:ServiceId>(\d+)<\/nc:ServiceId>/g)].map((match) => match[1]), ["5", "1", "14"]);
  assert.doesNotMatch(xml, /api\.netcash\.co\.za\/inbound-payments/);
});
test("Netcash validation response requires explicit account and service statuses", () => {
  assert.deepEqual(parseValidateServiceKeyResponse(responseXml("001")), { accountStatus: "001", services: [{ serviceId: "5", status: "001" }, { serviceId: "1", status: "001" }, { serviceId: "14", status: "001" }] });
  assert.throws(() => parseValidateServiceKeyResponse("<broken/>"), /NETCASH_RESPONSE_INVALID/);
});
test("Netcash diagnostics recognise a fully valid provider response", () => {
  const diagnostic = summariseNetcashValidation(parseValidateServiceKeyResponse(responseXml("001")));
  assert.equal(diagnostic.account.valid, true);
  assert.equal(diagnostic.validServiceCount, 3);
  assert.equal(diagnostic.allValid, true);
});
test("Netcash diagnostics distinguish partial provider validation", () => {
  const diagnostic = summariseNetcashValidation(parseValidateServiceKeyResponse(responseXml("001", "001", "106", "105")));
  assert.equal(diagnostic.account.valid, true);
  assert.equal(diagnostic.validServiceCount, 1);
  assert.equal(diagnostic.allValid, false);
  assert.deepEqual(diagnostic.services.map((item) => [item.label, item.status, item.message, item.valid]), [
    ["Account Services", "001", "Validated", true],
    ["Debit Orders and DebiCheck", "106", "Service key invalid or inactive", false],
    ["Pay Now", "105", "Service not active for this account", false],
  ]);
});
test("Netcash diagnostics describe account rejection and lockout codes", () => {
  assert.equal(describeNetcashStatus("104"), "Account invalid or inactive");
  assert.equal(describeNetcashStatus("201"), "Account temporarily locked");
  assert.equal(describeNetcashStatus("999"), "Netcash status 999");
});
test("Netcash SOAP faults and HTTP failures fail closed", async () => {
  await assert.rejects(
    () => validateNetcashServiceKeys(input, async () => new Response("<s:Fault><s:Reason><s:Text>Rejected</s:Text></s:Reason></s:Fault>", { status: 200 })),
    /NETCASH_SOAP_FAULT:Rejected/,
  );
  await assert.rejects(
    () => validateNetcashServiceKeys(input, async () => new Response("unavailable", { status: 503 })),
    /NETCASH_HTTP_503/,
  );
});
test("Netcash diagnostics never contain supplied service keys", () => {
  const diagnostic = summariseNetcashValidation(parseValidateServiceKeyResponse(responseXml("001", "001", "106", "105")));
  const serialised = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialised, new RegExp(input.accountServiceKey));
  assert.doesNotMatch(serialised, new RegExp(input.debitOrderServiceKey));
  assert.doesNotMatch(serialised, new RegExp(input.payNowServiceKey));
});

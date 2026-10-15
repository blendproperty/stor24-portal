import test from "node:test";
import assert from "node:assert/strict";
import { communicationFiltersSchema, communicationDateRange, readCommunicationQuery } from "../src/lib/communication-log-query";
import { communicationCursor, readCommunicationCursor } from "../src/lib/communication-log-cursor";

test("communication filters explicitly include complete SAST days", () => {
  const filters = communicationFiltersSchema.parse({ search: "  Brett Dovey  ", from: "2026-10-14", to: "2026-10-14", channel: "WHATSAPP", status: "SUCCEEDED" });
  assert.equal(filters.search, "Brett Dovey");
  const range = communicationDateRange(filters);
  assert.equal(range.gte?.toISOString(), "2026-10-13T22:00:00.000Z");
  assert.equal(range.lt?.toISOString(), "2026-10-14T22:00:00.000Z");
  for (const query of ["from=2026-10-15&to=2026-10-14", "from=2026-02-30", "channel=PHONE", "status=READ", "search=a&search=b", "export=CSV", "includeBody=true"]) assert.throws(() => readCommunicationQuery(new URLSearchParams(query)), /COMMUNICATION_FILTER_INVALID/);
  assert.throws(() => readCommunicationQuery(new URLSearchParams({ search: "x".repeat(201) })), /COMMUNICATION_FILTER_INVALID/);
});
test("communication paging binds both applied filters and the current actor/store scope", () => {
  const filters = communicationFiltersSchema.parse({ search: "Customer", status: "SUCCEEDED" });
  const scope = { userId: "synthetic-staff", organisationId: "synthetic-org", facilityIds: ["b", "a"], unrestrictedFacilities: false };
  const row = { id: "csyntheticlog0000000000001", queuedAt: new Date(Date.now() - 1000) }, snapshot = new Date();
  const encoded = communicationCursor(row, snapshot, filters, scope);
  assert.equal(readCommunicationCursor(encoded, filters, { ...scope, facilityIds: ["a", "b"] })?.id, row.id);
  assert.throws(() => readCommunicationCursor(encoded, { ...filters, search: "Different customer" }, scope), /COMMUNICATION_CURSOR_INVALID/);
  for (const changed of [{ ...scope, userId: "another-actor" }, { ...scope, organisationId: "foreign" }, { ...scope, facilityIds: ["a"] }, { ...scope, unrestrictedFacilities: true }]) assert.throws(() => readCommunicationCursor(encoded, filters, changed), /COMMUNICATION_CURSOR_INVALID/);
  for (const invalid of ["not-a-cursor", "a".repeat(1801), Buffer.from("{}").toString("base64url")]) assert.throws(() => readCommunicationCursor(invalid, filters, scope), /COMMUNICATION_CURSOR_INVALID/);
  const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.ok(!JSON.stringify(decoded).includes("Customer"));
  decoded.snapshot = new Date(Date.now() + 60_000).toISOString();
  assert.throws(() => readCommunicationCursor(Buffer.from(JSON.stringify(decoded)).toString("base64url"), filters, scope), /COMMUNICATION_CURSOR_INVALID/);
});

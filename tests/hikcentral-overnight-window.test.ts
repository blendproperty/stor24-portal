import assert from "node:assert/strict";
import test from "node:test";
import { hikCentralOvernightWindow } from "@/lib/hikcentral-overnight-window";

test("face lockouts use the 19:00–07:00 South Africa overnight window", () => {
  assert.equal(hikCentralOvernightWindow(new Date("2026-11-19T16:59:59Z")), null);
  const evening = hikCentralOvernightWindow(new Date("2026-11-19T17:00:00Z"));
  const morning = hikCentralOvernightWindow(new Date("2026-11-20T04:59:59Z"));
  assert.equal(evening?.date, "2026-11-19");
  assert.equal(morning?.date, evening?.date);
  assert.equal(evening?.start.toISOString(), "2026-11-19T17:00:00.000Z");
  assert.equal(evening?.end.toISOString(), "2026-11-20T05:00:00.000Z");
  assert.equal(hikCentralOvernightWindow(new Date("2026-11-20T05:00:00Z")), null);
});

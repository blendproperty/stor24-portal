import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { assertMoveOutDatePolicy } from "../src/lib/move-out-date-policy";
import { apiError } from "../src/lib/api";

const policy = (settings: Record<string, unknown>) => ({ defaults: { "Move Out": settings } });
test("saved date rules preserve absent/unlimited choices and enforce each date mode", () => {
  const now = new Date("2026-09-25T10:00:00Z"), dates = [new Date("2026-09-24"), new Date("2026-09-25"), new Date("2026-09-26")];
  for (const config of [undefined, null, {}, { defaults: {} }, policy({}), policy({ moveOutDate: "any", maxBackdatingDays: 0 })]) for (const date of dates) assert.doesNotThrow(() => assertMoveOutDatePolicy(config, date, now));
  for (const [mode, allowed] of [["today", [1]], ["todayFuture", [1, 2]], ["todayPast", [0, 1]]] as const) for (const [index, date] of dates.entries()) {
    if ((allowed as readonly number[]).includes(index)) assert.doesNotThrow(() => assertMoveOutDatePolicy(policy({ moveOutDate: mode }), date, now));
    else assert.throws(() => assertMoveOutDatePolicy(policy({ moveOutDate: mode }), date, now), /DATE_RESTRICTED/);
  }
});
test("backdating caps and month boundaries use South African calendar days", () => {
  const now = new Date("2026-09-24T22:05:00Z"); // Already 25 September in South Africa.
  assert.doesNotThrow(() => assertMoveOutDatePolicy(policy({ moveOutDate: "today" }), new Date("2026-09-25"), now));
  assert.throws(() => assertMoveOutDatePolicy(policy({ moveOutDate: "today" }), new Date("2026-09-24T21:59:00Z"), now), /DATE_RESTRICTED/);
  assert.doesNotThrow(() => assertMoveOutDatePolicy(policy({ maxBackdatingDays: 6 }), new Date("2026-09-19"), now));
  assert.throws(() => assertMoveOutDatePolicy(policy({ maxBackdatingDays: 6 }), new Date("2026-09-18"), now), /DATE_RESTRICTED/);
  assert.throws(() => assertMoveOutDatePolicy(policy({ restrictCurrentMonth: true, maxBackdatingDays: 0 }), new Date("2026-08-31"), new Date("2026-09-01")), /DATE_RESTRICTED/);
  assert.doesNotThrow(() => assertMoveOutDatePolicy(policy({ maxBackdatingDays: 1 }), new Date("2024-02-29"), new Date("2024-03-01")));
});
test("invalid saved date policy requires review instead of silently permitting dates", async () => {
  for (const config of [[], "bad", { defaults: [] }, { defaults: { "Move Out": false } }, ...[{ moveOutDate: ["today"] }, { moveOutDate: "unknown" }, { maxBackdatingDays: -1 }, { maxBackdatingDays: 1.5 }, { maxBackdatingDays: "6" }, { restrictCurrentMonth: "false" }].map(policy)]) assert.throws(() => assertMoveOutDatePolicy(config, new Date(), new Date()), /POLICY_REVIEW/);
  for (const code of ["MOVE_OUT_DATE_RESTRICTED", "MOVE_OUT_POLICY_REVIEW"]) {
    const response = apiError(new Error(code)); assert.equal(response.status, 409); assert.equal((await response.json()).error.code, code);
  }
});

test("move-out checks saved date rules before access or financial work", async () => {
  let reachedAccess = false;
  const database = {
    tenancy: { findFirst: async () => ({ id: "tenancy", facilityId: "facility", startDate: new Date("2000-01-01"), status: "ACTIVE", facility: {}, occupancies: [] }) },
    auditEvent: { findFirst: async () => null },
    configurationProfile: { findFirst: async (query: unknown) => {
      assert.deepEqual(query, { where: { organisationId: "org", facilityId: "facility", domain: "PROGRAM_DEFAULTS", name: "Default", status: "READY" }, select: { config: true } });
      return { config: { defaults: { "Move Out": { moveOutDate: "today" } } } };
    } },
    biometricEnrollment: { findMany: async () => { reachedAccess = true; throw Error("REACHED_ACCESS_WORK"); } },
  };
  const output = await build({ stdin: { contents: 'export {moveOut} from "./src/lib/leasing-service";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "synthetic-move-out", setup(b) {
    b.onResolve({ filter: /^@\/lib\/db$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const db=__db;" }));
  } }] });
  const loaded = { exports: {} as { moveOut: (scope: unknown, input: unknown) => Promise<unknown> } };
  new Function("require", "module", "exports", "__db", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database);
  const scope = { userId: "staff", organisationId: "org", facilityIds: ["facility"], unrestrictedFacilities: false };
  await assert.rejects(loaded.exports.moveOut(scope, { tenancyId: "tenancy", movedOutAt: new Date("2001-01-01"), finalCharge: 0, depositAmount: 0, depositAction: "NONE", idempotencyKey: "synthetic", notes: "Synthetic" }), /MOVE_OUT_DATE_RESTRICTED/);
  assert.equal(reachedAccess, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";

test("real route guards reject CSO writes, revoked grants, foreign stores and cross-origin requests", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci"); assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const org = await db.organisation.create({ data: { name: "Scope CI", slug: randomUUID() } });
  const foreign = await db.organisation.create({ data: { name: "Foreign CI", slug: randomUUID() } });
  try {
    const store = await db.facility.create({ data: { organisationId: org.id, name: "A", code: "A" } });
    const other = await db.facility.create({ data: { organisationId: org.id, name: "B", code: "B" } });
    const foreignStore = await db.facility.create({ data: { organisationId: foreign.id, name: "Private", code: "P" } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Limited CSO", permissions: ["operations.view", "inventory.view"] } });
    const user = await db.user.create({ data: { organisationId: org.id, name: "CI", email: `${randomUUID()}@example.invalid`, roleAssignments: { create: { roleId: role.id, facilityId: store.id } } } });
    const type = await db.unitType.create({ data: { facilityId: store.id, name: "5sqm", areaSqMetres: 5 } });
    const unit = await db.unit.create({ data: { facilityId: store.id, unitTypeId: type.id, number: "G01", monthlyRate: 100 } });
    const session = { userId: user.id, sessionVersion: user.sessionVersion, mfaVerified: true };
    async function load(entry: string) {
      const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-session", setup(b) {
        b.onResolve({ filter: /^@\/(lib\/(db|session)|generated\/prisma\/client)$/ }, a => ({ path: a.path, namespace: "fixture" }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : a.path.endsWith("/session") ? "export const getSession=async()=>__session;" : "export const Prisma=__Prisma;" }));
      } }] });
      const loaded = { exports: {} as { POST: (r: Request) => Promise<Response>; GET: (r: Request) => Promise<Response> } };
      new Function("require", "module", "exports", "__db", "__session", "__Prisma", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, session, Prisma);
      return loaded.exports;
    }
    const pricing = await load("src/app/api/v1/leasing/units/pricing/route.ts"), calendar = await load("src/app/api/v1/calendar/work/route.ts");
    const rates = { facilityId: store.id, unitIds: [unit.id], mode: "AMOUNT", value: 10, action: "preview" };
    const work = { requestKey: randomUUID(), input: { facilityId: store.id, assigneeId: user.id, title: "CI meeting", purpose: "MEETING", startAt: "2026-10-23T08:00:00.000Z", endAt: "2026-10-23T10:00:00.000Z" } };
    const send = (route: typeof pricing, body: unknown, origin = "https://example.invalid") => route.POST(new Request("https://example.invalid/api", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal((await send(pricing, rates)).status, 403); assert.equal((await send(calendar, work)).status, 403);
    await db.role.update({ where: { id: role.id }, data: { permissions: ["operations.view", "operations.manage", "inventory.manage"] } });
    assert.equal((await send(pricing, rates, "https://attacker.invalid")).status, 403);
    assert.equal((await send(pricing, rates)).status, 200);
    for (const facilityId of [other.id, foreignStore.id]) {
      assert.equal((await send(pricing, { ...rates, facilityId })).status, 403);
      assert.equal((await send(calendar, { ...work, requestKey: randomUUID(), input: { ...work.input, facilityId } })).status, 403);
    }
    assert.equal((await send(calendar, work)).status, 200);
    await db.role.update({ where: { id: role.id }, data: { permissions: [] } });
    assert.equal((await send(pricing, rates)).status, 403); assert.equal((await send(calendar, work)).status, 403);
    assert.equal((await calendar.GET(new Request("https://example.invalid/api?start=2026-10-23T00:00:00Z&end=2026-10-30T00:00:00Z"))).status, 403);
    assert.equal(Number((await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).monthlyRate), 100);
  } finally { await db.organisation.delete({ where: { id: org.id } }); await db.organisation.delete({ where: { id: foreign.id } }); await db.$disconnect(); }
});

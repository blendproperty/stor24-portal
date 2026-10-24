/* eslint-disable @typescript-eslint/no-explicit-any -- Real PostgreSQL delegates are injected into isolated route bundles. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { db } from "../../src/lib/db";
import { createCustomer, moveIn } from "../../src/lib/leasing-service";
import { Prisma } from "../../src/generated/prisma/client";

type Bag = Record<string, any>;
async function load(entry: string, session: Bag, database: any = db) {
  const effects = { notifications: 0, welcomes: 0 };
  const mocks: Record<string, string> = {
    "@/lib/db": "export const db=__db;",
    "@/generated/prisma/client": "export const Prisma=__Prisma;",
    "@/lib/session": "export const getSession=async()=>__session;",
    "@/lib/notifications": "export const notifyReservationConfirmed=async()=>{__effects.notifications++};export const notifyViewingBooked=async()=>{__effects.notifications++};",
    "@/lib/tenant-welcome-email": "export const welcomeTenantWhenReady=async()=>{__effects.welcomes++};",
  };
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "isolated-extended-security", setup(b) {
    b.onResolve({ filter: /^@\/(lib|generated)\// }, a => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "fixture" } : undefined);
    b.onResolve({ filter: /^\./ }, a => {
      const key = Object.keys(mocks).find(key => resolve(a.resolveDir, a.path).replace(/\.ts$/, "") === resolve("src", key.slice(2)));
      return key ? { path: key, namespace: "fixture" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: mocks[a.path] }));
  } }] });
  const loaded = { exports: {} as Bag };
  new Function("require", "module", "exports", "__db", "__session", "__effects", "__Prisma", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database, session, effects, Prisma);
  return { api: loaded.exports, effects };
}

test("extended boundaries use isolated PostgreSQL and synthetic records only", async t => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, "localhost"); assert.equal(target.pathname, "/merchandise_ci");
  const org = await db.organisation.create({ data: { name: "Synthetic extended security", slug: randomUUID() } });
  const other = await db.organisation.create({ data: { name: "Synthetic foreign security", slug: randomUUID() } });
  const a = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic A", code: randomUUID() } });
  const b = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic B", code: randomUUID() } });
  const foreign = await db.facility.create({ data: { organisationId: other.id, name: "Synthetic foreign", code: randomUUID(), publicSlug: `security-${randomUUID()}`, publicBookingEnabled: true } });
  const actor = await db.user.create({ data: { organisationId: org.id, name: "Synthetic actor", email: `${randomUUID()}@example.invalid`, passwordHash: "synthetic-not-a-login" } });
  const role = await db.role.create({ data: { organisationId: org.id, name: "Synthetic scoped authority", permissions: ["reservations.manage", "move_in.create", "configuration.manage"] } });
  const phone = await db.role.create({ data: { organisationId: org.id, name: "Synthetic unrelated authority", permissions: ["phone.view"] } });
  await db.roleAssignment.create({ data: { userId: actor.id, roleId: role.id, facilityId: a.id } });
  const unrelated = await db.roleAssignment.create({ data: { userId: actor.id, roleId: phone.id, facilityId: b.id } });
  const session = { userId: actor.id, sessionVersion: actor.sessionVersion, mfaVerified: true };
  const scope = { userId: actor.id, organisationId: org.id, facilityIds: [a.id], unrestrictedFacilities: false };
  const own = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic own", leads: { create: { facilityId: a.id, source: "CI" } } } });
  const hidden = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic hidden", leads: { create: { facilityId: b.id, source: "CI" } } } });
  const stranger = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic unlinked other" } });
  const mine = await createCustomer(scope, { firstName: "Synthetic unlinked creator", lastName: "Fixture" });
  const type = await db.unitType.create({ data: { facilityId: a.id, name: "Synthetic unit type" } });
  const unit = async () => db.unit.create({ data: { facilityId: a.id, unitTypeId: type.id, number: randomUUID(), monthlyRate: 100 } });
  try {
    await t.test("reservation reads and writes ignore unrelated facility and global roles", async () => {
      const { api } = await load("src/app/api/v1/reservations/route.ts", session);
      for (const facilityId of [b.id, null]) {
        await db.roleAssignment.update({ where: { id: unrelated.id }, data: { facilityId } });
        const response = await api.GET(); assert.equal(response.status, 200);
        const customers = (await response.json()).data.customers;
        assert.deepEqual(new Set(customers.map((row: Bag) => row.id)), new Set([own.id, mine.id]));
        assert.ok(customers.every((row: Bag) => !Object.hasOwn(row, "identityRef") && !Object.hasOwn(row, "billingAddress")));
        const selected = await unit();
        const body = { facilityId: a.id, customerId: hidden.id, unitId: selected.id, quotedRate: 100, holdExpiresAt: new Date(Date.now() + 600000).toISOString(), intendedMoveIn: "2026-11-01" };
        const post = (customerId: string) => api.POST(new Request("http://localhost/api/v1/reservations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ ...body, customerId }) }));
        assert.equal((await post(hidden.id)).status, 403);
        assert.equal(await db.reservation.count({ where: { unitId: selected.id } }), 0);
        assert.equal((await post(own.id)).status, 201);
      }
      assert.equal(await db.customer.count({ where: { id: stranger.id } }), 1);
    });

    await t.test("move-in cannot acquire hidden customers through a newly created tenancy", async () => {
      const selected = await unit();
      const input = { facilityId: a.id, customerId: hidden.id, unitId: selected.id, startDate: new Date("2026-11-01T00:00:00Z"), initialCharge: 0, paymentMethod: "CARD" as const, accessState: "PENDING" as const };
      await assert.rejects(moveIn(scope, input), /FORBIDDEN/);
      assert.equal(await db.account.count({ where: { customerId: hidden.id } }), 0);
      assert.equal(await db.tenancy.count({ where: { customerId: hidden.id } }), 0);
      const result = await moveIn(scope, { ...input, customerId: mine.id });
      assert.equal(result.tenancy.customerId, mine.id); assert.equal(result.tenancy.status, "DRAFT");
    });

    await t.test("global configuration still rejects a foreign-organisation facility and ignores historical poisoned rows", async () => {
      const global = await db.role.create({ data: { organisationId: org.id, name: "Synthetic global configuration", permissions: ["configuration.manage"] } });
      await db.roleAssignment.create({ data: { userId: actor.id, roleId: global.id } });
      const { api } = await load("src/app/api/v1/configuration/route.ts", session);
      for (const payload of [
        { kind: "profile", payload: { facilityId: foreign.id, domain: "STORE_INFORMATION", name: "Default", status: "READY", config: { phone: "Poisoned synthetic phone" } } },
        { kind: "integration", payload: { facilityId: foreign.id, category: "PHONE", provider: "Synthetic", status: "CONFIGURED", config: {} } },
      ]) assert.equal((await api.PUT(new Request("http://localhost/api", { method: "PUT", body: JSON.stringify(payload) }))).status, 403);
      assert.equal(await db.configurationProfile.count({ where: { organisationId: org.id, facilityId: foreign.id } }), 0);
      await db.configurationProfile.create({ data: { organisationId: org.id, facilityId: foreign.id, domain: "STORE_INFORMATION", name: "Default", status: "READY", config: { phone: "Poisoned synthetic phone" } } });
      await db.configurationProfile.create({ data: { organisationId: other.id, facilityId: foreign.id, domain: "STORE_INFORMATION", name: "Default", status: "READY", config: { phone: "Approved synthetic phone" } } });
      const previous = process.env.PUBLIC_BOOKING_API_KEY; process.env.PUBLIC_BOOKING_API_KEY = "synthetic-security-key-at-least-32-characters";
      try {
        const publicRoute = await load("src/app/api/public/v1/facilities/[slug]/route.ts", session);
        const response = await publicRoute.api.GET(new Request("http://localhost/api", { headers: { "x-stor24-public-key": "synthetic-security-key-at-least-32-characters" } }), { params: Promise.resolve({ slug: foreign.publicSlug }) });
        assert.equal(response.status, 200); assert.equal((await response.json()).data.storeInformation.phone, "Approved synthetic phone");
      } finally { if (previous === undefined) delete process.env.PUBLIC_BOOKING_API_KEY; else process.env.PUBLIC_BOOKING_API_KEY = previous; }
    });

    await t.test("mobile and email OTP budgets are atomic and bound to the exact challenge", async () => {
      const old = process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED; process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED = "true";
      try {
        for (const channel of ["mobile", "email"] as const) for (const change of ["unchanged", "replaced", "expired"] as const) {
          const limit = channel === "mobile" ? 5 : 10, parallel = 6;
          const selected = await unit();
          const customer = await db.customer.create({ data: { organisationId: org.id, firstName: "Synthetic OTP", email: `${randomUUID()}@example.invalid`, phone: "+27000000000", communicationConsent: { email: false, sms: false, phone: false, whatsapp: false } } });
          const id = randomUUID(); let readers = 0, release!: () => void;
          const barrier = new Promise<void>(resolve => { release = resolve; });
          const database = { reservation: {
            findUnique: async (args: any) => { const value = await db.reservation.findUnique(args); readers++; if (readers === parallel) {
              if (change === "replaced") await db.reservation.update({ where: { id }, data: { verificationCodeHash: "f".repeat(64), verificationAttempts: 0 } });
              if (change === "expired") await db.reservation.update({ where: { id }, data: { verificationExpiresAt: new Date(0) } });
              release();
            } await barrier; return value; },
            updateMany: db.reservation.updateMany.bind(db.reservation), update: db.reservation.update.bind(db.reservation),
          }, $transaction: db.$transaction.bind(db) };
          const { api, effects } = await load("src/lib/public-booking-service.ts", session, database);
          const hash = (channel === "mobile" ? api.verificationHash : api.emailVerificationHash)(id, "123456");
          const booking = await db.reservation.create({ data: { id, facilityId: a.id, customerId: customer.id, unitId: selected.id, quotedRate: 100, publicReference: `ST24-CI-${randomUUID().slice(0, 12)}`, journey: "RENTAL", contactVerifiedAt: channel === "email" ? new Date() : null, verificationCodeHash: hash, verificationExpiresAt: new Date(Date.now() + 60000), verificationAttempts: limit - 1 } });
          const verify = channel === "mobile" ? api.verifyPublicReservation : api.verifyPublicReservationEmail;
          const results = await Promise.all(Array.from({ length: parallel }, () => verify(booking.publicReference, "000000")));
          assert.equal(results.filter(row => row.code === "INVALID_CODE").length, change === "unchanged" ? 1 : 0);
          const saved = await db.reservation.findUniqueOrThrow({ where: { id } });
          assert.equal(saved.verificationAttempts, change === "replaced" ? 0 : change === "unchanged" ? limit : limit - 1);
          assert.equal(effects.notifications, 0); assert.equal(effects.welcomes, 0);
          if (change === "unchanged") {
            assert.equal((await verify(booking.publicReference, "123456")).code, "EXPIRED");
            await db.reservation.update({ where: { id }, data: { verificationCodeHash: hash, verificationExpiresAt: new Date(Date.now() + 60000), verificationAttempts: limit - 1 } });
            const accepted = await verify(booking.publicReference, "123456"); assert.equal(accepted.ok, true); assert.equal(typeof accepted.identityAccessToken, "string");
            assert.equal((await verify(booking.publicReference, "123456")).ok, false);
            assert.equal((await db.reservation.findUniqueOrThrow({ where: { id } })).verificationAttempts, limit);
          }
        }
      } finally { if (old === undefined) delete process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED; else process.env.PUBLIC_RESERVATION_VERIFICATION_ENABLED = old; }
    });
  } finally { await db.$disconnect(); }
});

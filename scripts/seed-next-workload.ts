import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, chownSync } from "node:fs";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  assert.equal(process.env.STOR24_NEXT_WORKLOAD_TEST, "isolated-container");
  assert.match(process.env.WORKLOAD_PROJECT ?? "", /^stor24-next-workload-[a-f0-9]{12}$/);
  assert.match(process.env.WORKLOAD_SOURCE_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.match(process.env.WORKLOAD_STAFF_PASSWORD ?? "", /^[a-f0-9]{40}$/);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "postgres");
  assert.equal(url.pathname, "/stor24_staging");
  assert.equal(url.username, "stor24_stage");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 2, application_name: "stor24-workload-fixture" }) });
  const folder = "/workload-evidence";
  const sourceSha = process.env.WORKLOAD_SOURCE_SHA;
  try {
    if (process.argv.includes("--verify")) {
      const seed = JSON.parse(readFileSync(`${folder}/seed.json`, "utf8"));
      assert.equal(seed.sourceSha, sourceSha);
      const evidence = {
        sourceSha, verifiedAt: new Date().toISOString(), scope: "isolated Next-hosted synthetic workload only",
        customers: await db.customer.count({ where: { organisationId: seed.org } }),
        notes: await db.customerNote.count({ where: { organisationId: seed.org } }),
        reservations: await db.reservation.count({ where: { facilityId: seed.store } }),
        payments: await db.payment.count({ where: { account: { customer: { organisationId: seed.org } } } }),
        ledgerEntries: await db.ledgerEntry.count({ where: { account: { customer: { organisationId: seed.org } } } }),
        webhookOutbox: await db.webhookOutbox.count({ where: { organisationId: seed.org } }),
        serverConnections: (await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='stor24-crm' AND datname=current_database()`)[0].count,
      };
      writeFileSync(`${folder}/database-result.json`, JSON.stringify(evidence, null, 2));
      assert.equal(evidence.customers, 182); //180 measured + other-store + queued offline lead
      assert.equal(evidence.notes, 585);
      assert.equal(evidence.reservations, 46);
      assert.equal(evidence.payments, 0);
      assert.equal(evidence.ledgerEntries, 150);
      assert.equal(evidence.webhookOutbox, 0);
      assert.ok(evidence.serverConnections <= 10);
      console.log("ISOLATED_WORKLOAD_DATABASE_VERIFIED");
    } else {
      // Never reset/reuse an existing business dataset, even inside a test deployment.
      assert.equal(await db.organisation.count(), 0);
      assert.equal(await db.user.count(), 0);
      const run = randomUUID();
      const org = await db.organisation.create({ data: { name: "Synthetic workload only", slug: "synthetic-staging" } });
      const store = await db.facility.create({ data: { organisationId: org.id, name: "Synthetic Midpoint workload", code: "A" } });
      const foreign = await db.facility.create({ data: { organisationId: org.id, name: "Private other store", code: "B" } });
      const role = await db.role.create({ data: { organisationId: org.id, name: "Synthetic scoped staff", permissions: ["operations.view", "operations.manage", "communications.view", "reservations.manage", "reports.view", "leads.create"] } });
      const passwordHash = await hash(process.env.WORKLOAD_STAFF_PASSWORD!, 12);
      const users = await Promise.all(Array.from({ length: 25 }, (_, i) => db.user.create({ data: { organisationId: org.id, name: `Fixture staff ${i}`, email: `${run}-${i}@example.invalid`, passwordHash, roleAssignments: { create: { roleId: role.id, facilityId: store.id } } } })));
      const customers = await Promise.all(Array.from({ length: 180 }, (_, i) => db.customer.create({ data: { organisationId: org.id, firstName: `Synthetic ${String(i).padStart(3, "0")}`, lastName: "Workload", leads: { create: { facilityId: store.id, source: "OTHER" } } } })));
      const hidden = await db.customer.create({ data: { organisationId: org.id, firstName: "PRIVATE-OTHER-STORE", leads: { create: { facilityId: foreign.id, source: "OTHER" } } } });
      const type = await db.unitType.create({ data: { facilityId: store.id, name: "Workload storage", features: [] } });
      const units = await Promise.all(Array.from({ length: 210 }, (_, i) => db.unit.create({ data: { facilityId: store.id, unitTypeId: type.id, number: `S${i}`, monthlyRate: 100, status: i < 150 ? "OCCUPIED" : "AVAILABLE" } })));
      for (let i = 0; i < 150; i++) {
        const account = await db.account.create({ data: { customerId: customers[i].id, accountNumber: `${run}-${i}`, tenancy: { create: { customerId: customers[i].id, facilityId: store.id, startDate: new Date("2026-01-01"), status: "ACTIVE", occupancies: { create: { unitId: units[i].id, status: "ACTIVE", startDate: new Date("2026-01-01"), monthlyRate: 100 } } } } } });
        await db.ledgerEntry.create({ data: { accountId: account.id, type: "CHARGE", amount: 100, description: "Synthetic retained charge", effectiveAt: new Date("2026-10-01") } });
      }
      await db.customerNote.createMany({ data: customers.flatMap(customer => Array.from({ length: 3 }, (_, i) => ({ organisationId: org.id, facilityId: store.id, customerId: customer.id, authorId: users[0].id, authorName: "Fixture staff 0", category: "HANDOVER", body: `Synthetic handover detail ${i}`, requestKey: randomUUID() }))) });
      await db.communicationLog.createMany({ data: customers.map(customer => ({ organisationId: org.id, facilityId: store.id, customerId: customer.id, channel: "EMAIL", recipientHash: "synthetic", idempotencyKey: randomUUID(), messageType: "RENT_NOTICE", status: "SUCCEEDED", metadata: { historyEvidence: { version: 1, text: "Synthetic retained communication", redacted: true } } })) });
      mkdirSync(folder, { recursive: true });
      chownSync(folder, 1001, 1001);
      writeFileSync(`${folder}/seed.json`, JSON.stringify({ sourceSha, project: process.env.WORKLOAD_PROJECT, org: org.id, store: store.id, foreign: foreign.id, hidden: hidden.id, users: users.map(u => ({ id: u.id, email: u.email })), customers: customers.map(c => c.id), units: units.map(u => u.id) }), { mode: 0o644 });
      console.log("ISOLATED_WORKLOAD_SEEDED");
    }
  } finally { await db.$disconnect(); }
}
void main().catch(error => {
  const code = /^[A-Z_0-9]+$/.test(error?.code ?? "") ? error.code : "ISOLATED_SEED_FAILED";
  console.error(code);
  process.exitCode = 1;
});

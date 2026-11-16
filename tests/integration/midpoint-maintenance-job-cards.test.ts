import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { MIDPOINT_MAINTENANCE_MANAGER, MIDPOINT_STORE } from "../../src/lib/maintenance-job-policy";

test("Midpoint job cards require Carlo's report and Katlego's verification", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const org = await db.organisation.create({ data: { name: "Synthetic job cards", slug: randomUUID() } });
  try {
    const midpoint = await db.facility.create({ data: { organisationId: org.id, name: MIDPOINT_STORE, code: "MID" } });
    const other = await db.facility.create({ data: { organisationId: org.id, name: "Other", code: "OTHER" } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Test", permissions: ["operations.view", "operations.manage"] } });
    const person = (email: string, facilityId = midpoint.id) => db.user.create({
      data: { organisationId: org.id, name: email.split("@")[0], email, passwordHash: "synthetic", roleAssignments: { create: { roleId: role.id, facilityId } } },
    });
    const katlego = await person("katlego@stor24.co.za");
    const colleague = await person("unrelated@example.invalid");
    const unitType = await db.unitType.create({ data: { facilityId: midpoint.id, name: "Synthetic", widthMetres: 2, lengthMetres: 2, features: [] } });
    const unit = await db.unit.create({ data: { facilityId: midpoint.id, unitTypeId: unitType.id, number: "TEST", status: "AVAILABLE", monthlyRate: 100 } });

    const state = { session: { userId: katlego.id, sessionVersion: katlego.sessionVersion, mfaVerified: true } };
    async function route<T>(path: string) {
      const output = await build({
        entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
        plugins: [{ name: "authenticated-route-fixture", setup(builder) {
          builder.onResolve({ filter: /^(?:@\/lib\/|\.\/)(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
            contents: args.path.endsWith("db") ? "export const db=__db;" : "export const getSession=async()=>__state.session;",
          }));
        } }],
      });
      const loaded = { exports: {} as T };
      new Function("require", "module", "exports", "__db", "__state", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, db, state);
      return loaded.exports;
    }
    const { POST } = await route<{ POST: (request: Request) => Promise<Response> }>("src/app/api/v1/operations/route.ts");
    const { PATCH } = await route<{ PATCH: (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }>("src/app/api/v1/operations/maintenance/[id]/route.ts");
    const request = (method: string, body: object, origin = "https://example.invalid") => new Request("https://example.invalid/api", {
      method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const create = (facilityId = midpoint.id, unitId?: string) => POST(request("POST", { kind: "maintenance", payload: { facilityId, unitId, title: "Synthetic repair", jobCard: true } }));
    const signIn = (user: typeof katlego) => { state.session = { userId: user.id, sessionVersion: user.sessionVersion, mfaVerified: true }; };
    assert.equal((await create(other.id)).status, 403);
    signIn(colleague);
    assert.equal((await create()).status, 403);
    signIn(katlego);
    const created = await create(midpoint.id, unit.id);
    assert.ok(created.ok, await created.clone().text());
    const { data: { id } } = await created.json();
    const current = () => db.maintenanceRequest.findUniqueOrThrow({ where: { id } });
    const unitStatus = async () => (await db.unit.findUniqueOrThrow({ where: { id: unit.id } })).status;
    const act = async (data: object, origin?: string) => PATCH(request("PATCH", { updatedAt: (await current()).updatedAt.toISOString(), ...data }, origin), { params: Promise.resolve({ id }) });

    assert.equal((await current()).assignedToId, null);
    assert.equal(await unitStatus(), "SERVICE");
    assert.equal((await act({ action: "verify", note: "Premature close" })).status, 403);
    assert.equal((await act({ status: "COMPLETED" })).status, 422);

    const carlo = await person(MIDPOINT_MAINTENANCE_MANAGER, other.id);
    signIn(carlo);
    assert.equal((await act({ action: "report", evidence: "Different store" })).status, 403);
    await db.roleAssignment.updateMany({ where: { userId: carlo.id }, data: { facilityId: midpoint.id } });
    assert.equal((await act({ action: "report", evidence: "Cross origin" }, "https://other.invalid")).status, 403);
    const oldVersion = (await current()).updatedAt.toISOString();
    const update = { action: "manage", updatedAt: oldVersion, status: "SCHEDULED", contractor: "Synthetic contractor", scheduledFor: "2026-11-17T08:00:00.000Z", progressNotes: "Booked" };
    const attempts = await Promise.all([act(update), act(update)]);
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
    assert.equal((await current()).assignedToId, carlo.id);
    assert.equal((await current()).contractor, "Synthetic contractor");
    assert.equal((await act({ action: "report", evidence: "Repair record A" })).status, 200);
    assert.equal(await unitStatus(), "SERVICE");
    assert.equal((await act({ action: "verify", note: "Self verification" })).status, 403);
    signIn(katlego);
    assert.equal((await act({ action: "return", note: "Joint still leaks" })).status, 200);
    assert.equal((await current()).repairReportedAt, null);
    signIn(carlo);
    assert.equal((await act({ action: "report", evidence: "Repair record B" })).status, 200);
    signIn(katlego);
    assert.equal((await act({ action: "verify", note: "Inspected and dry" })).status, 200);
    assert.equal(await unitStatus(), "AVAILABLE");
    assert.equal((await current()).status, "COMPLETED");
    assert.equal((await act({ action: "cancel", note: "Cannot rewrite history" })).status, 403);
    assert.equal(await db.auditEvent.count({ where: { entityId: id, action: "maintenance.job_card.verify", actorId: katlego.id } }), 1);
    const next = await create();
    assert.ok(next.ok);
    assert.equal((await next.json()).data.assignedToId, carlo.id);
    assert.equal(await db.communicationLog.count({ where: { organisationId: org.id } }), 0);
  } finally {
    await db.auditEvent.deleteMany({ where: { organisationId: org.id } });
    await db.maintenanceRequest.deleteMany({ where: { organisationId: org.id } });
    await db.roleAssignment.deleteMany({ where: { user: { organisationId: org.id } } });
    await db.user.deleteMany({ where: { organisationId: org.id } });
    await db.organisation.delete({ where: { id: org.id } });
    await db.$disconnect();
  }
});

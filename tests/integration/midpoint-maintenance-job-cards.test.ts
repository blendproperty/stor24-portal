import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { db } from "../../src/lib/db";
import { MIDPOINT_JOB_CARD_PERMISSION, MIDPOINT_JOB_CARD_ROLE, MIDPOINT_MAINTENANCE_MANAGER, MIDPOINT_STORE } from "../../src/lib/maintenance-job-policy";

test("Midpoint job cards require Carlo's report and Katlego's verification", async () => {
  assert.equal(process.env.MERCHANDISE_DB_TEST, "isolated-ci");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "localhost");
  const org = await db.organisation.create({ data: { name: "Synthetic job cards", slug: randomUUID() } });
  try {
    const midpoint = await db.facility.create({ data: { organisationId: org.id, name: MIDPOINT_STORE, code: "MID" } });
    const other = await db.facility.create({ data: { organisationId: org.id, name: "Other", code: "OTHER" } });
    const role = await db.role.create({ data: { organisationId: org.id, name: "Test", permissions: ["operations.view", "operations.manage"] } });
    const person = (email: string, facilityId = midpoint.id, roleId = role.id) => db.user.create({
      data: { organisationId: org.id, name: email.split("@")[0], email, passwordHash: "synthetic", roleAssignments: { create: { roleId, facilityId } } },
    });
    const katlego = await person("katlego@stor24.co.za");
    const colleague = await person("unrelated@example.invalid");
    const unitType = await db.unitType.create({ data: { facilityId: midpoint.id, name: "Synthetic", widthMetres: 2, lengthMetres: 2, features: [] } });
    const unit = await db.unit.create({ data: { facilityId: midpoint.id, unitTypeId: unitType.id, number: "TEST", status: "AVAILABLE", monthlyRate: 100 } });

    const state = { session: { userId: katlego.id, name: katlego.name, sessionVersion: katlego.sessionVersion, mfaVerified: true } };
    async function route<T>(path: string) {
      const output = await build({
        entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
        plugins: [{ name: "authenticated-route-fixture", setup(builder) {
          builder.onResolve({ filter: /^(?:@\/lib\/|\.\/)(db|session)$/ }, args => ({ path: args.path, namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
            contents: args.path.endsWith("db") ? "export const db=__db;" : "export const getSession=async()=>__state.session; export const setSession=async()=>{};",
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
    const signIn = (user: typeof katlego) => { state.session = { userId: user.id, name: user.name, sessionVersion: user.sessionVersion, mfaVerified: true }; };
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

    await db.$executeRawUnsafe(readFileSync("prisma/migrations/20261116162000_midpoint_job_card_manager/migration.sql", "utf8"));
    const manager = await db.role.findUniqueOrThrow({
      where: { organisationId_name: { organisationId: org.id, name: MIDPOINT_JOB_CARD_ROLE } },
    });
    assert.deepEqual(manager.permissions, [MIDPOINT_JOB_CARD_PERMISSION]);
    const ownerRole = await db.role.create({ data: { organisationId: org.id, name: "Organisation owner", permissions: ["*"] } });
    const owner = await db.user.create({
      data: { organisationId: org.id, email: "owner@example.invalid", name: "Owner", passwordHash: "synthetic", roleAssignments: { create: { roleId: ownerRole.id } } },
    });
    signIn(owner);
    const invitations = await route<{ POST: (request: Request) => Promise<Response>; GET: () => Promise<Response> }>("src/app/api/v1/invitations/route.ts");
    const acceptance = await route<{ POST: (request: Request) => Promise<Response> }>("src/app/api/v1/invitations/accept/route.ts");
    const details = { name: "Carlo Viviers", email: MIDPOINT_MAINTENANCE_MANAGER, roleName: MIDPOINT_JOB_CARD_ROLE, facilityCode: midpoint.code };
    assert.equal((await invitations.POST(request("POST", { ...details, facilityCode: other.code }))).status, 422);
    assert.equal((await invitations.POST(request("POST", { ...details, email: "other@example.invalid" }))).status, 422);
    const invites = await Promise.all([invitations.POST(request("POST", details)), invitations.POST(request("POST", details))]);
    assert.deepEqual(invites.map(response => response.status).sort(), [201, 409]);
    const manual = invites.find(response => response.status === 201)!;
    assert.equal(manual.headers.get("Cache-Control"), "private, no-store");
    const invitation = (await manual.json()).data;
    assert.equal(invitation.delivery, "MANUAL");
    const token = new URL(invitation.inviteUrl).pathname.split("/").at(-1);
    assert.equal((await (await invitations.GET()).text()).includes(token!), false);
    const accept = () => acceptance.POST(request("POST", { token, password: "Synthetic-Test-Long-Password1" }));
    const accepted = await accept();
    assert.ok(accepted.ok, await accepted.clone().text());
    assert.equal((await accept()).status, 410);
    const carlo = await db.user.findUniqueOrThrow({
      where: { organisationId_email: { organisationId: org.id, email: MIDPOINT_MAINTENANCE_MANAGER } },
      include: { roleAssignments: true },
    });
    assert.deepEqual(carlo.roleAssignments.map(({ roleId, facilityId }) => [roleId, facilityId]), [[manager.id, midpoint.id]]);
    await db.roleAssignment.updateMany({ where: { userId: carlo.id }, data: { facilityId: other.id } });
    const { GET } = await route<{ GET: () => Promise<Response> }>("src/app/api/v1/operations/job-cards/route.ts");
    const operations = await route<{ GET: () => Promise<Response> }>("src/app/api/v1/operations/route.ts");
    signIn(carlo);
    assert.equal((await act({ action: "report", evidence: "Different store" })).status, 403);
    assert.equal((await GET()).status, 403);
    await db.roleAssignment.updateMany({ where: { userId: carlo.id }, data: { facilityId: midpoint.id } });
    assert.equal((await act({ action: "report", evidence: "Cross origin" }, "https://other.invalid")).status, 403);
    assert.equal((await operations.GET()).status, 403);
    assert.equal((await create()).status, 403);
    const ordinary = await db.maintenanceRequest.create({ data: { title: "Ordinary request", facilityId: midpoint.id, organisationId: org.id } });
    const ordinaryPatch = await PATCH(request("PATCH", { status: "COMPLETED" }), { params: Promise.resolve({ id: ordinary.id }) });
    assert.equal(ordinaryPatch.status, 404);
    const queue = await GET();
    assert.equal(queue.status, 200);
    assert.equal(queue.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual((await queue.json()).data.map((row: { id: string }) => row.id), [id]);
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
    await db.userInvitation.deleteMany({ where: { organisationId: org.id } });
    await db.roleAssignment.deleteMany({ where: { user: { organisationId: org.id } } });
    await db.user.deleteMany({ where: { organisationId: org.id } });
    await db.organisation.delete({ where: { id: org.id } });
    await db.$disconnect();
  }
});

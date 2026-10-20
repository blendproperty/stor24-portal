import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

const organisationSlug = "stor24";

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createInvitationToken() {
  return randomBytes(32).toString("base64url");
}

export async function ensureStor24Workspace() {
  const organisation = await db.organisation.upsert({
    where: { slug: organisationSlug },
    update: {},
    create: {
      name: "Stor24",
      slug: organisationSlug,
    },
  });

  await Promise.all([
    db.facility.upsert({
      where: { organisationId_code: { organisationId: organisation.id, code: "RANDBURG" } },
      update: {},
      create: { organisationId: organisation.id, name: "Stor24 Randburg", code: "RANDBURG" },
    }),
    ...[
      { name: "Organisation owner", permissions: ["*"] },
      { name: "Facility manager", permissions: ["facility.*", "users.view", "operations.*", "inventory.*", "daily_close.*", "configuration.view", "facility_map.view", "phone.view", "reports.view", "reports.export", "communications.view", "integrations.view", "access.view", "access.manage"] },
      { name: "Sales / leasing", permissions: ["leads.*", "reservations.*", "move_in.create", "operations.view", "facility_map.view", "phone.view", "reports.sales", "communications.view"] },
      { name: "Customer service operator", permissions: ["leads.*", "reservations.*", "move_in.create", "operations.view", "operations.manage", "facility_map.view", "phone.view", "communications.view", "customer_history.export", "reservation_prices.view", "reservation_prices.propose"] },
      { name: "Collections", permissions: ["collections.*", "access.suspend", "access.restore", "reports.collections", "communications.view"] },
      { name: "Finance", permissions: ["ledger.*", "payments.*", "daily_close.*", "configuration.view", "reports.view", "reports.financial", "reports.export", "reports.schedule", "integrations.view"] },
      { name: "Auditor / read only", permissions: ["*.view", "reports.financial", "reports.export"] },
    ].map((role) =>
      db.role.upsert({
        where: { organisationId_name: { organisationId: organisation.id, name: role.name } },
        update: { permissions: role.permissions },
        create: { organisationId: organisation.id, ...role },
      }),
    ),
  ]);

  return organisation;
}

export async function expireOldInvitations() {
  await db.userInvitation.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

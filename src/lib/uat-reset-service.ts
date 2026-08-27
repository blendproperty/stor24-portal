import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export type UatResetPreview = {
  customers: number;
  leads: number;
  reservations: number;
  paymentSessions: number;
  tenancies: number;
  occupancies: number;
  documents: number;
  accounts: number;
  payments: number;
  ledgerEntries: number;
  biometricEnrollments: number;
  customerTasksDetached: number;
  communicationsAnonymised: number;
  unitsReleased: number;
};

async function preview(tx: Tx, organisationId: string): Promise<UatResetPreview> {
  const customers = await tx.customer.findMany({
    where: { organisationId },
    select: { id: true, accounts: { select: { id: true } }, tenancies: { select: { id: true } } },
  });
  const customerIds = customers.map((customer) => customer.id);
  const accountIds = customers.flatMap((customer) => customer.accounts.map((account) => account.id));
  const tenancyIds = customers.flatMap((customer) => customer.tenancies.map((tenancy) => tenancy.id));
  if (!customerIds.length) {
    return {
      customers: 0, leads: 0, reservations: 0, paymentSessions: 0, tenancies: 0,
      occupancies: 0, documents: 0, accounts: 0, payments: 0, ledgerEntries: 0,
      biometricEnrollments: 0, customerTasksDetached: 0, communicationsAnonymised: 0,
      unitsReleased: 0,
    };
  }
  const reservations = await tx.reservation.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true, unitId: true },
  });
  const reservationIds = reservations.map((reservation) => reservation.id);
  const occupiedUnitIds = await tx.occupancy.findMany({
    where: { tenancyId: { in: tenancyIds }, status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } },
    select: { unitId: true },
    distinct: ["unitId"],
  });
  const releasableUnitIds = [...new Set([
    ...reservations.map((reservation) => reservation.unitId),
    ...occupiedUnitIds.map((occupancy) => occupancy.unitId),
  ])];
  const [leads, paymentSessions, occupancies, documents, payments, ledgerEntries, biometrics, tasks, communications, units] = await Promise.all([
    tx.lead.count({ where: { customerId: { in: customerIds } } }),
    tx.publicPaymentSession.count({ where: { reservationId: { in: reservationIds } } }),
    tx.occupancy.count({ where: { tenancyId: { in: tenancyIds } } }),
    tx.document.count({ where: { tenancyId: { in: tenancyIds } } }),
    tx.payment.count({ where: { accountId: { in: accountIds } } }),
    tx.ledgerEntry.count({ where: { accountId: { in: accountIds } } }),
    tx.biometricEnrollment.count({ where: { customerId: { in: customerIds } } }),
    tx.task.count({ where: { customerId: { in: customerIds } } }),
    tx.communicationLog.count({ where: { customerId: { in: customerIds } } }),
    tx.unit.count({ where: { id: { in: releasableUnitIds }, status: { in: ["HELD", "RESERVED", "OCCUPIED"] } } }),
  ]);
  return {
    customers: customerIds.length,
    leads,
    reservations: reservationIds.length,
    paymentSessions,
    tenancies: tenancyIds.length,
    occupancies,
    documents,
    accounts: accountIds.length,
    payments,
    ledgerEntries,
    biometricEnrollments: biometrics,
    customerTasksDetached: tasks,
    communicationsAnonymised: communications,
    unitsReleased: units,
  };
}

export function getUatResetPreview(organisationId: string) {
  return preview(db, organisationId);
}

export async function resetUatCustomerData(input: {
  organisationId: string;
  actorId: string;
}) {
  return db.$transaction(async (tx) => {
    const counts = await preview(tx, input.organisationId);
    const customers = await tx.customer.findMany({
      where: { organisationId: input.organisationId },
      select: { id: true, accounts: { select: { id: true } }, tenancies: { select: { id: true } } },
    });
    const customerIds = customers.map((customer) => customer.id);
    if (!customerIds.length) return counts;
    const accountIds = customers.flatMap((customer) => customer.accounts.map((account) => account.id));
    const tenancyIds = customers.flatMap((customer) => customer.tenancies.map((tenancy) => tenancy.id));
    const reservations = await tx.reservation.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true, unitId: true },
    });
    const occupancyUnits = await tx.occupancy.findMany({
      where: { tenancyId: { in: tenancyIds } },
      select: { unitId: true },
      distinct: ["unitId"],
    });
    const unitIds = [...new Set([
      ...reservations.map((reservation) => reservation.unitId),
      ...occupancyUnits.map((occupancy) => occupancy.unitId),
    ])];

    await tx.task.updateMany({ where: { customerId: { in: customerIds } }, data: { customerId: null } });
    await tx.communicationLog.updateMany({ where: { customerId: { in: customerIds } }, data: { customerId: null } });
    await tx.reservation.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.lead.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.payment.deleteMany({ where: { accountId: { in: accountIds } } });
    await tx.ledgerEntry.deleteMany({ where: { accountId: { in: accountIds } } });
    await tx.tenancy.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.account.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.customer.deleteMany({ where: { id: { in: customerIds }, organisationId: input.organisationId } });
    await tx.unit.updateMany({
      where: { id: { in: unitIds }, status: { in: ["HELD", "RESERVED", "OCCUPIED"] } },
      data: { status: "AVAILABLE" },
    });
    await tx.auditEvent.create({
      data: {
        organisationId: input.organisationId,
        actorId: input.actorId,
        action: "uat.customer_data_reset",
        entityType: "Organisation",
        entityId: input.organisationId,
        after: counts as unknown as Prisma.InputJsonValue,
      },
    });
    return counts;
  }, { timeout: 30_000 });
}

import { createHash } from "node:crypto";
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
  customerNotes: number;
  unitsReleased: number;
  merchandiseOrders: number;
  merchandiseRequests: number;
  collectionCases: number;
  financialAdjustments: number;
  debitInstructions: number;
};

async function preview(tx: Tx, organisationId: string, ids?: string[]): Promise<UatResetPreview> {
  const customers = await tx.customer.findMany({
    where: { organisationId, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, accounts: { select: { id: true } }, tenancies: { select: { id: true } } },
  });
  const customerIds = customers.map((customer) => customer.id);
  const accountIds = customers.flatMap((customer) => customer.accounts.map((account) => account.id));
  const tenancyIds = customers.flatMap((customer) => customer.tenancies.map((tenancy) => tenancy.id));
  if (!customerIds.length) {
    return {
      customers: 0, leads: 0, reservations: 0, paymentSessions: 0, tenancies: 0,
      occupancies: 0, documents: 0, accounts: 0, payments: 0, ledgerEntries: 0,
      biometricEnrollments: 0, customerTasksDetached: 0, communicationsAnonymised: 0, customerNotes: 0,
      unitsReleased: 0, merchandiseOrders: 0, merchandiseRequests: 0,
      collectionCases: 0, financialAdjustments: 0, debitInstructions: 0,
    };
  }
  const reservations = await tx.reservation.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true, unitId: true },
  });
  const reservationIds = reservations.map((reservation) => reservation.id);
  const occupiedUnitIds = await tx.occupancy.findMany({
    where: { tenancyId: { in: tenancyIds } },
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
    tx.unit.count({ where: { id: { in: releasableUnitIds }, facility: { organisationId }, status: { in: ["HELD", "RESERVED", "OCCUPIED"] },
      reservations: { none: { status: "ACTIVE", customerId: { notIn: customerIds } } },
      occupancies: { none: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] }, tenancyId: { notIn: tenancyIds } } },
    } }),
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
    customerNotes: await tx.customerNote.count({ where: { customerId: { in: customerIds }, organisationId } }),
    unitsReleased: units,
    merchandiseOrders: await tx.merchandiseOrder.count({ where: { accountId: { in: accountIds } } }),
    merchandiseRequests: await tx.tenantMerchandiseRequest.count({ where: { customerId: { in: customerIds } } }),
    collectionCases: await tx.collectionCase.count({ where: { accountId: { in: accountIds } } }),
    financialAdjustments: await tx.financialAdjustment.count({ where: { accountId: { in: accountIds } } }),
    debitInstructions: await tx.debitOrderInstruction.count({ where: { accountId: { in: accountIds } } }),
  };
}

export async function getTestCustomerCleanupPreview(organisationId: string, ids: string[], tx: Tx = db) {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error("CONFLICT");
  const customers = await tx.customer.findMany({
    where: { organisationId, id: { in: ids } }, orderBy: { id: "asc" },
    include: {
      leads: true, reservations: { include: { publicLease: { include: { mandate: true } }, publicPaymentSessions: true } },
      tenancies: { include: { mandateSession: true, documents: true, insuranceEnrollment: true, occupancies: true } },
      accounts: { include: { payments: true, debitInstructions: true, ledgerEntries: true, adjustments: true, merchandiseOrders: { include: { items: true } }, collectionCase: { include: { activities: true, promises: true } } } },
      biometricEnrollments: true, integrationIdentityLink: true, staffNotes: true,
      communications: { where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } } },
    },
  });
  if (customers.length !== ids.length) throw new Error("NOT_FOUND");
  const accountIds = customers.flatMap(c => c.accounts.map(a => a.id));
  const relatedIds = [...ids, ...accountIds, ...customers.flatMap(c => [
    ...c.reservations.map(r => r.id), ...c.tenancies.map(t => t.id),
    ...c.accounts.flatMap(a => a.payments.map(p => p.id)),
  ])];
  const [workflowRecords, queuedJobs, reallocations, importPostings] = await Promise.all([
    tx.configurationProfile.findMany({ where: { organisationId, OR: [
      { name: { in: relatedIds } }, ...relatedIds.flatMap(id => ["customerId", "accountId", "reservationId", "tenancyId"].map(key => ({ config: { path: [key], equals: id } }))),
    ] } }),
    tx.webhookOutbox.findMany({ where: { organisationId, aggregateId: { in: relatedIds }, status: { in: ["PENDING", "PROCESSING", "FAILED"] } } }),
    tx.receiptReallocation.findMany({ where: { organisationId, OR: [{ sourceAccountId: { in: accountIds } }, { targetAccountId: { in: accountIds } }] } }),
    tx.receiptImportPosting.findMany({ where: { organisationId, accountId: { in: accountIds } } }),
  ]);
  for (const rows of [workflowRecords, queuedJobs, reallocations, importPostings]) rows.sort((a, b) => a.id.localeCompare(b.id));
  const counts = { ...await preview(tx, organisationId, ids),
    agreements: customers.reduce((n, c) => n + c.reservations.filter(r => r.publicLease).length, 0),
    mandates: customers.reduce((n, c) => n + c.tenancies.filter(t => t.mandateSession).length + c.reservations.filter(r => r.publicLease?.mandate).length, 0),
    insuranceEnrollments: customers.reduce((n, c) => n + c.tenancies.filter(t => t.insuranceEnrollment).length, 0),
    identityLinks: customers.filter(c => c.integrationIdentityLink).length,
    pendingCommunicationsCancelled: customers.reduce((n, c) => n + c.communications.length, 0),
    queuedJobsCancelled: queuedJobs.length, savedWorkflowRecords: workflowRecords.length,
    receiptReallocations: reallocations.length, importedReceipts: importPostings.length,
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({ customers, counts, workflowRecords, queuedJobs, reallocations, importPostings })).digest("hex");
  return { customers: customers.map(c => ({ id: c.id, name: c.companyName || [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed customer" })), counts, fingerprint };
}

export function getUatResetPreview(organisationId: string) {
  return preview(db, organisationId);
}

export async function resetUatCustomerData(input: {
  organisationId: string;
  actorId: string;
  selection?: { ids: string[]; fingerprint: string };
}) {
  return db.$transaction(async (tx) => {
    let selectedReview: Awaited<ReturnType<typeof getTestCustomerCleanupPreview>> | undefined;
    if (input.selection) {
      const review = await getTestCustomerCleanupPreview(input.organisationId, input.selection.ids, tx);
      selectedReview = review;
      if (review.fingerprint !== input.selection.fingerprint) throw new Error("CONFLICT");
    }
    const counts = selectedReview?.counts ?? await preview(tx, input.organisationId);
    const customers = await tx.customer.findMany({
      where: { organisationId: input.organisationId, ...(input.selection ? { id: { in: input.selection.ids } } : {}) },
      select: { id: true, accounts: { select: { id: true, payments: { select: { id: true } } } }, tenancies: { select: { id: true } } },
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

    const externalReferences = input.selection ? await tx.customer.findMany({
      where: { organisationId: input.organisationId, id: { in: customerIds } },
      select: { id: true,
        integrationIdentityLink: { select: { melIntegrationLinkId: true, hikCentralPersonId: true } },
        biometricEnrollments: { select: { externalPersonId: true, externalPersonCode: true, providerReference: true } },
        accounts: { select: { payments: { select: { provider: true, environment: true, providerRef: true } } } },
        reservations: { select: { publicLease: { select: { mandate: { select: { reference: true, environment: true, status: true } } } } } },
        tenancies: { select: { mandateSession: { select: { mandate: { select: { reference: true, environment: true, status: true } } } }, insuranceEnrollment: { select: { providerName: true, status: true } } } },
      },
    }) : undefined;
    if (input.selection) {
      const relatedIds = [...customerIds, ...accountIds, ...tenancyIds, ...reservations.map(r => r.id), ...customers.flatMap(c => c.accounts.flatMap(a => a.payments.map(p => p.id)))];
      await tx.configurationProfile.deleteMany({ where: { organisationId: input.organisationId, OR: [
        { name: { in: relatedIds } }, ...relatedIds.flatMap(id => ["customerId", "accountId", "reservationId", "tenancyId"].map(key => ({ config: { path: [key], equals: id } }))),
      ] } });
      await tx.webhookOutbox.updateMany({ where: { organisationId: input.organisationId, aggregateId: { in: relatedIds }, status: { in: ["PENDING", "PROCESSING", "FAILED"] } }, data: { status: "DEAD_LETTER", nextAttemptAt: null, failureCode: "TEST_CUSTOMER_DELETED", failureMessage: "Cancelled by owner-selected test customer cleanup." } });
      await tx.communicationLog.updateMany({ where: { customerId: { in: customerIds }, status: { in: ["PENDING", "PROCESSING", "FAILED"] } }, data: { status: "DEAD_LETTER", nextRetryAt: null, failureCode: "TEST_CUSTOMER_DELETED", failureMessage: "Cancelled by owner-selected test customer cleanup." } });
      await tx.tenantPortalChallenge.deleteMany({ where: { organisationId: input.organisationId, customerIds: { hasSome: customerIds } } });
      await tx.tenantPortalSession.updateMany({ where: { organisationId: input.organisationId, customerIds: { hasSome: customerIds }, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    // Delete restrictive dependants before payments/accounts/customers. Keep the
    // catalogue and physical stock; release only reservations owned by these orders.
    const orders = await tx.merchandiseOrder.findMany({
      where: { accountId: { in: accountIds } }, include: { items: true },
    });
    const heldByProduct = new Map<string, { quantity: number; facilityId: string }>();
    for (const order of orders) {
      if (order.organisationId !== input.organisationId) throw new Error("UAT_RESET_SCOPE_CONFLICT");
      if (!order.stockHeld) continue;
      for (const item of order.items) {
        const held = heldByProduct.get(item.productId);
        if (held && held.facilityId !== order.facilityId) throw new Error("UAT_RESET_SCOPE_CONFLICT");
        heldByProduct.set(item.productId, { quantity: (held?.quantity ?? 0) + item.quantity, facilityId: order.facilityId });
      }
    }
    for (const [productId, held] of [...heldByProduct].sort(([a], [b]) => a.localeCompare(b))) {
      const released = await tx.product.updateMany({
        where: { id: productId, organisationId: input.organisationId, facilityId: held.facilityId, quantityReserved: { gte: held.quantity } },
        data: { quantityReserved: { decrement: held.quantity } },
      });
      if (released.count !== 1) throw new Error("UAT_RESET_STOCK_REVIEW_REQUIRED");
    }
    await tx.merchandiseOrderItem.deleteMany({ where: { orderId: { in: orders.map(order => order.id) } } });
    await tx.merchandiseOrder.deleteMany({ where: { id: { in: orders.map(order => order.id) } } });
    await tx.tenantMerchandiseRequest.deleteMany({ where: { customerId: { in: customerIds } } });
    const cases = await tx.collectionCase.findMany({ where: { accountId: { in: accountIds } }, select: { id: true } });
    const caseIds = cases.map(item => item.id);
    await tx.collectionActivity.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.collectionPromise.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.collectionCase.deleteMany({ where: { id: { in: caseIds } } });
    await tx.financialAdjustment.deleteMany({ where: { accountId: { in: accountIds } } });
    const runs = await tx.debitOrderRun.findMany({
      where: { instructions: { some: { accountId: { in: accountIds } } } },
      select: { id: true, organisationId: true, instructions: { select: { accountId: true } } },
    });
    if (runs.some(run => run.organisationId !== input.organisationId || (!input.selection && run.instructions.some(item => !accountIds.includes(item.accountId))))) {
      throw new Error("UAT_RESET_SCOPE_CONFLICT");
    }
    await tx.debitOrderInstruction.deleteMany({ where: { accountId: { in: accountIds } } });
    await tx.debitOrderRun.deleteMany({ where: { id: { in: runs.filter(run => run.instructions.every(item => accountIds.includes(item.accountId))).map(run => run.id) } } });
    const reallocations = await tx.receiptReallocation.findMany({ where: { organisationId: input.organisationId, OR: [{ sourceAccountId: { in: accountIds } }, { targetAccountId: { in: accountIds } }] }, select: { id: true } });
    const reallocationIds = reallocations.map(row => row.id);
    await tx.receiptReallocation.deleteMany({ where: { id: { in: reallocationIds }, organisationId: input.organisationId } });
    await tx.receiptImportPosting.deleteMany({ where: { organisationId: input.organisationId, accountId: { in: accountIds } } });
    await tx.task.updateMany({ where: { customerId: { in: customerIds } }, data: { customerId: null } });
    await tx.communicationLog.updateMany({ where: { customerId: { in: customerIds } }, data: { customerId: null } });
    await tx.reservation.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.lead.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.payment.deleteMany({ where: { accountId: { in: accountIds } } });
    await tx.ledgerEntry.deleteMany({ where: { accountId: { in: accountIds } } });
    await tx.tenancy.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.account.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.customer.deleteMany({ where: { id: { in: customerIds }, organisationId: input.organisationId } });
    const releasedUnits = await tx.unit.updateMany({
      where: { id: { in: unitIds }, facility: { organisationId: input.organisationId },
        status: { in: ["HELD", "RESERVED", "OCCUPIED"] },
        reservations: { none: { status: "ACTIVE" } },
        occupancies: { none: { status: { in: ["PENDING", "ACTIVE", "NOTICE_GIVEN"] } } },
      },
      data: { status: "AVAILABLE" },
    });
    counts.unitsReleased = releasedUnits.count;
    await tx.auditEvent.create({
      data: {
        organisationId: input.organisationId,
        actorId: input.actorId,
        action: "uat.customer_data_reset",
        entityType: "Organisation",
        entityId: input.organisationId,
        ...(externalReferences ? { before: { externalReferences } as unknown as Prisma.InputJsonValue } : {}),
        after: { ...counts, ...(input.selection ? { customerIds, reason: "SELECTED_TEST_CUSTOMERS" } : {}) } as unknown as Prisma.InputJsonValue,
      },
    });
    return counts;
  }, { timeout: 30_000, isolationLevel: "Serializable" });
}

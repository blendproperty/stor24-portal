import { AccountStatementWorkspace } from "@/components/account-statement-workspace";
import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { statementAccountScope } from "@/lib/finance/account-statement";

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("ledger.view");
  const { id } = await params;
  const account = await db.account.findFirst({
    where: statementAccountScope(id, auth.organisationId, auth.allowedFacilityIds),
    select: { accountNumber: true, customerId: true },
  });
  const reservationId = account?.accountNumber.startsWith("ST24-T-") ? account.accountNumber.slice(7) : null;
  const reservation = reservationId && account ? await db.reservation.findFirst({
    where: {
      id: reservationId, customerId: account.customerId,
      customer: { organisationId: auth.organisationId },
      ...(auth.allowedFacilityIds ? { facilityId: { in: auth.allowedFacilityIds } } : {}),
      status: { in: ["ACTIVE", "CONVERTED"] },
    },
    select: { id: true },
  }) : null;
  return <AccountStatementWorkspace accountId={id} moveInReservationId={reservation?.id} />;
}

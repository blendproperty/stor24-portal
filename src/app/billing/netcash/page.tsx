import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermissionScope } from "@/lib/scope";
import { reconcileNetcashPayment } from "@/lib/payments/netcash-reconciliation";

export const metadata = { title: "Netcash payment operations" };
export const dynamic = "force-dynamic";

const stateLabel = {
  MATCHED: "Ledger matched",
  MISSING_LEDGER: "Ledger missing",
  DUPLICATE_LEDGER: "Duplicate ledger",
  PENDING: "Awaiting confirmation",
  FAILED: "Not collected",
} as const;

const stateClass = {
  MATCHED: "success",
  MISSING_LEDGER: "danger",
  DUPLICATE_LEDGER: "danger",
  PENDING: "warning",
  FAILED: "neutral",
} as const;

function money(value: unknown) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value));
}

export default async function NetcashPaymentsPage() {
  const scope = await requirePermissionScope("payments.view");
  const payments = await db.payment.findMany({
    where: {
      provider: "NETCASH",
      account: {
        customer: { organisationId: scope.organisationId },
        ...(scope.unrestrictedFacilities ? {} : { tenancy: { facilityId: { in: scope.facilityIds } } }),
      },
    },
    include: {
      account: {
        include: {
          customer: true,
          tenancy: { include: { facility: true, occupancies: { include: { unit: true }, orderBy: { startDate: "desc" }, take: 1 } } },
          ledgerEntries: { where: { type: "PAYMENT" }, orderBy: { effectiveAt: "desc" }, take: 100 },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 250,
  });

  const rows = payments.map((payment) => ({ payment, reconciliation: reconcileNetcashPayment(payment, payment.account.ledgerEntries) }));
  const matched = rows.filter((row) => row.reconciliation.state === "MATCHED").length;
  const exceptions = rows.filter((row) => ["MISSING_LEDGER", "DUPLICATE_LEDGER"].includes(row.reconciliation.state)).length;
  const pending = rows.filter((row) => row.reconciliation.state === "PENDING").length;
  const failed = rows.filter((row) => row.reconciliation.state === "FAILED").length;

  return <div className="page-stack">
    <PageHeader eyebrow="Financial control" title="Netcash payment operations" description="Monitor provider outcomes against Stor24 payment and ledger records. This view proves internal posting; Netcash settlement-statement matching remains a separate provider-controlled step." action={<Link href="/settings/integrations/netcash" className="button button-secondary">Netcash settings</Link>} />
    <section className="summary-strip netcash-ops-summary">
      <div className="summary-cell"><span>Ledger matched</span><strong>{matched}</strong></div>
      <div className="summary-cell"><span>Exceptions</span><strong>{exceptions}</strong></div>
      <div className="summary-cell"><span>Pending</span><strong>{pending}</strong></div>
      <div className="summary-cell"><span>Not collected</span><strong>{failed}</strong></div>
    </section>
    <section className="panel netcash-ops-note"><AlertTriangle size={18} /><div><strong>Settlement is not yet reconciled</strong><p>These controls match Stor24’s Payment and LedgerEntry records. Do not treat them as proof of bank settlement until the Netcash statement contract has been verified and imported.</p></div></section>
    <section className="panel table-panel">
      <div className="panel-heading"><div><h2>Recent Netcash payments</h2><p>Latest 250 attempts, newest first.</p></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Created</th><th>Customer / account</th><th>Payment</th><th>Provider reference</th><th>Outcome</th><th>Internal reconciliation</th></tr></thead><tbody>
        {rows.map(({ payment, reconciliation }) => {
          const customer = payment.account.customer;
          const name = customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer";
          const unit = payment.account.tenancy?.occupancies[0]?.unit.number;
          const Icon = reconciliation.state === "MATCHED" ? CheckCircle2 : reconciliation.state === "PENDING" ? Clock3 : reconciliation.state === "FAILED" ? XCircle : AlertTriangle;
          return <tr key={payment.id}>
            <td>{payment.createdAt.toLocaleString("en-ZA")}</td>
            <td><strong>{name}</strong><small>{payment.account.accountNumber}{unit ? ` · Unit ${unit}` : ""}</small></td>
            <td><strong>{money(payment.amount)}</strong><small>{payment.method.replaceAll("_", " ")}</small></td>
            <td><code>{payment.providerRef || "Awaiting reference"}</code></td>
            <td><span className={`status-pill ${payment.status === "SUCCEEDED" ? "success" : payment.status === "PENDING" ? "warning" : "neutral"}`}>{payment.status.replaceAll("_", " ")}</span>{payment.failureCode ? <small>{payment.failureCode}</small> : null}</td>
            <td><span className={`netcash-reconciliation-state ${stateClass[reconciliation.state]}`}><Icon size={14} />{stateLabel[reconciliation.state]}</span></td>
          </tr>;
        })}
        {!rows.length ? <tr><td colSpan={6} className="empty-cell"><CreditCard size={22} />No Netcash payment attempts are recorded for your permitted facilities.</td></tr> : null}
      </tbody></table></div>
    </section>
  </div>;
}

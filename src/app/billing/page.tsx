import { netCollectionTotal } from "@/lib/finance/collection-total";
import { requirePermissionScope, facilityWhere } from "@/lib/scope";
import { Banknote, CreditCard, FileText, Receipt, RefreshCcw, WalletCards } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";

export const metadata = { title: "Billing & payments" };
export const dynamic = "force-dynamic";

const modules = [
  [WalletCards, "Settlement reconciliation", "Review full merchant statements, receipt matches, bank payouts and retained funds.", "/billing/settlements", "Reconcile settlements"],
  [FileText, "Monthly billing", "Review approved rent, fees, discounts and premiums; post charges with a saved invoice.", "/billing/monthly", "Review monthly billing"],
  [CreditCard, "Netcash operations", "Match Netcash outcomes to Stor24 payment and ledger records and surface exceptions.", "/billing/netcash", "Review Netcash"],
  [CreditCard, "Take payment", "Post a card, bank, cash or EFT payment and allocate it to open charges.", "/operations/accounts", "Open accounts"],
  [RefreshCcw, "Debit-order runs", "Review mandates and monthly invoices, prepare test batches and track upload outcomes.", "/billing/debit-orders", "Review debit orders"],
  [FileText, "Invoices & statements", "Generate and export available account and financial reports.", "/reports", "Open reports"],
  [Receipt, "Receipt audit", "Trace posted payments, reversals, refunds and operator activity.", "/audit", "Open audit trail"],
  [Banknote, "Refund approvals", "Route refunds and write-offs through controlled adjustments.", "/adjustments", "Open adjustments"],
  [WalletCards, "Daily close", "Review financial reporting used for reconciliation and period close.", "/reports", "Open reports"],
] as const;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(value);
}

export default async function BillingPage() {
  const scope = await requirePermissionScope("billing.view");
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [balanceAgg, paymentsAgg, activeTenancyCount] = await Promise.all([
    db.account.aggregate({ _sum: { balance: true }, where: { customer: { organisationId: scope.organisationId }, tenancy: { facility: facilityWhere(scope) } } }),
    netCollectionTotal(scope, monthStart),
    db.tenancy.count({ where: { status: "ACTIVE", facility: facilityWhere(scope) } }),
  ]);

  const outstandingBalance = Number(balanceAgg._sum.balance ?? 0);
  const collectedThisMonth = paymentsAgg;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Financial operations"
        title="Billing & payments"
        description="Operate the tenant subledger, recurring billing, payments, refunds and daily reconciliation."
        action={<Link href="/operations/accounts" className="button button-primary"><CreditCard size={16} /> Take payment</Link>}
      />
      <section className="summary-strip">
        {[
          ["Net collected this month", formatCurrency(collectedThisMonth), "/operations/accounts"],
          ["Outstanding balance", formatCurrency(outstandingBalance), "/collections"],
          ["Active tenancies billed", String(activeTenancyCount), "/tenants"],
        ].map(([label, value, href]) => (
          <Link className="summary-cell" href={href} key={label}><span>{label}</span><strong>{value}</strong></Link>
        ))}
      </section>
      <section className="module-grid">
        {modules.map(([Icon, title, copy, href, action]) => (
          <Link className="module-card" href={href} key={title}><Icon size={22} /><h3>{title}</h3><p>{copy}</p><span className="text-button">{action} →</span></Link>
        ))}
      </section>
    </div>
  );
}

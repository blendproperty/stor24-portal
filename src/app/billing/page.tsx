import { Banknote, CreditCard, FileText, Receipt, RefreshCcw, WalletCards } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";

export const metadata = { title: "Billing & payments" };
export const dynamic = "force-dynamic";

const modules = [
  [CreditCard, "Take payment", "Post a card, bank, cash or EFT payment and allocate it to open charges.", "/operations/accounts", "Open accounts"],
  [RefreshCcw, "Autopay runs", "Review recurring-payment and arrears work requiring follow-up.", "/collections", "Open collections"],
  [FileText, "Invoices & statements", "Generate and export available account and financial reports.", "/reports", "Open reports"],
  [Receipt, "Receipt audit", "Trace posted payments, reversals, refunds and operator activity.", "/audit", "Open audit trail"],
  [Banknote, "Refund approvals", "Route refunds and write-offs through controlled adjustments.", "/adjustments", "Open adjustments"],
  [WalletCards, "Daily close", "Review financial reporting used for reconciliation and period close.", "/reports", "Open reports"],
] as const;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(value);
}

export default async function BillingPage() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [balanceAgg, paymentsAgg, activeTenancyCount] = await Promise.all([
    db.account.aggregate({ _sum: { balance: true } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { status: "SUCCEEDED", processedAt: { gte: monthStart } } }),
    db.tenancy.count({ where: { status: "ACTIVE" } }),
  ]);

  const outstandingBalance = Number(balanceAgg._sum.balance ?? 0);
  const collectedThisMonth = Number(paymentsAgg._sum.amount ?? 0);

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
          ["Collected this month", formatCurrency(collectedThisMonth), "/operations/accounts"],
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

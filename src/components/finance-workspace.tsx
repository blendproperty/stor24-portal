import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/auth-guards";
import { canVisit } from "@/lib/navigation-access";

const workspaces = {
  invoicing: {
    title: "Invoicing", permission: "billing.view", description: "Review monthly charges and invoices, statements and rent reviews.",
    links: [
      ["Monthly billing", "Review approved charges and post monthly invoices.", "/billing/monthly"],
      ["Invoices and statements", "Find financial reports and statements.", "/reports"],
      ["Rent reviews", "Review recorded rent changes and tenant duration.", "/billing/rent-reviews"],
      ["MRI accounting", "Review monthly ledger movements for accounting.", "/billing/mri"],
      ["Financial overview", "Open the existing financial operations overview.", "/billing"],
    ],
  },
  payments: {
    title: "Payments", permission: "payments.view", description: "Record and review payments, reconcile receipts and manage payment runs.",
    links: [
      ["Customer accounts and payments", "Record and allocate a payment to an account.", "/operations/accounts"],
      ["Payments awaiting review", "Investigate unresolved payment records.", "/operations/payment-review"],
      ["Netcash operations", "Review provider outcomes and payment requests.", "/billing/netcash"],
      ["Settlement reconciliation", "Review merchant statements and bank payouts.", "/billing/settlements"],
      ["Unidentified payment review", "Investigate and match unidentified receipts.", "/billing/unidentified-receipts"],
      ["Debit-order runs", "Review mandates and prepare debit-order batches.", "/billing/debit-orders"],
      ["Refund approvals", "Review controlled adjustments and refunds.", "/adjustments"],
      ["Receipt audit", "Trace payments and operator activity.", "/audit"],
    ],
  },
} as const;

export async function FinanceWorkspace({ kind }: { kind: keyof typeof workspaces }) {
  const workspace = workspaces[kind];
  const auth = await requirePermission(workspace.permission);
  const access = { owner: auth.role === "Organisation owner", permissions: auth.permissions };
  const links = workspace.links.filter(([, , href]) => canVisit(href, access));
  return <div className="page-stack finance-hub-workspace">
    <PageHeader eyebrow="Financial operations" title={workspace.title} description={workspace.description}/>
    <div className="module-grid">{links.map(([title, description, href]) => <Link className="module-card" href={href} key={href}>
      <h2>{title}</h2><p>{description}</p><span className="text-button">Open →</span>
    </Link>)}</div>
    {!links.length && <p>No finance workflows are available for your current permissions.</p>}
  </div>;
}

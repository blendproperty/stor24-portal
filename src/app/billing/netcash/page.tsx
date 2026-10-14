import {netcashOperationScope,readNetcashEvidence,NETCASH_EVIDENCE_DOMAIN,netcashMethodLabels} from "@/lib/payments/netcash-payment-evidence";
import {NetcashEvidenceAction} from "@/components/netcash-evidence-action";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { requirePermissionScope } from "@/lib/scope";
import { reconcileNetcashPayment } from "@/lib/payments/netcash-reconciliation";

export const metadata = { title: "Netcash payment operations" };
export const dynamic = "force-dynamic";

const stateLabel = {
  TEST: "Test — not live money",
  CORRECTED: "Corrected — review source",
  MATCHED: "Ledger matched",
  MISSING_LEDGER: "Ledger missing",
  DUPLICATE_LEDGER: "Duplicate ledger",
  PENDING: "Awaiting confirmation",
  FAILED: "Not collected",
} as const;

const stateClass = {
  TEST: "neutral",
  CORRECTED: "warning",
  MATCHED: "success",
  MISSING_LEDGER: "danger",
  DUPLICATE_LEDGER: "danger",
  PENDING: "warning",
  FAILED: "neutral",
} as const;

function money(value: unknown) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value));
}

export default async function NetcashPaymentsPage({searchParams}:{searchParams:Promise<{facilityId?:string;mode?:string;method?:string}>}) {
  const params=await searchParams;
  const scope = await requirePermissionScope("payments.view");
  const operation=await netcashOperationScope(scope,params.facilityId);
  const payments = await db.payment.findMany({
    where: operation.where,
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

  const proofRows=await db.configurationProfile.findMany({where:{organisationId:scope.organisationId,domain:NETCASH_EVIDENCE_DOMAIN,name:{in:payments.map(p=>p.id)}}});
  const visible=payments.filter(p=>!!p.providerFacilityId||!p.account.accountNumber.startsWith("ST24-T-")||operation.sources.some(r=>`ST24-T-${r.id}`===p.account.accountNumber&&r.customerId===p.account.customerId));
  const rows = visible.map((payment) => ({ payment, evidence:readNetcashEvidence(proofRows.find(r=>r.name===payment.id)?.config,payment), reconciliation: reconcileNetcashPayment(payment, payment.account.ledgerEntries) })).filter(r=>(params.mode!=="test"||r.reconciliation.state==="TEST")&&(params.mode!=="live"||r.reconciliation.state!=="TEST")&&(!params.method||r.evidence?.methodCode===params.method));
  const matched = rows.filter((row) => row.reconciliation.state === "MATCHED").length;
  const exceptions = rows.filter((row) => ["MISSING_LEDGER", "DUPLICATE_LEDGER"].includes(row.reconciliation.state)).length;
  const pending = rows.filter((row) => row.reconciliation.state === "PENDING").length;
  const failed = rows.filter((row) => row.reconciliation.state === "FAILED").length;

  return <div className="page-stack payment-monitor-workspace">
    <PageHeader eyebrow="Financial control" title="Netcash payment operations" description="Monitor provider outcomes against Stor24 payment and ledger records. This view checks internal matching; use Settlement reconciliation for provider statements and bank evidence." action={<Link href="/settings/integrations/netcash" className="button button-secondary">Netcash settings</Link>} />
    <section className="summary-strip netcash-ops-summary">
      <div className="summary-cell"><span>Ledger matched</span><strong>{matched}</strong></div>
      <div className="summary-cell"><span>Exceptions</span><strong>{exceptions}</strong></div>
      <div className="summary-cell"><span>Pending</span><strong>{pending}</strong></div>
      <div className="summary-cell"><span>Not collected</span><strong>{failed}</strong></div>
    </section>
    <section className="panel netcash-ops-note"><AlertTriangle size={18} /><div><strong>Internal matching is separate from bank settlement</strong><p>These controls compare payment and ledger records. Open <Link href="/billing/settlements">Settlement reconciliation</Link> to import the full provider statement, match bank payouts and independently review evidence.</p></div></section>
    <section className="panel"><h2>Payment visibility and full Netcash scope</h2><p>Pay Now is the gateway, not the selected card/EFT method. Refresh a recorded payment to classify it from Netcash’s server response. Card and Instant EFT tests are kept separate from live receipts. In Netcash, use the developer account’s Pay Now → Reports → Processed Transactions and include Auth/Declined test results.</p><form className="form-grid" method="GET"><label>Mode<select name="mode" defaultValue={params.mode??""}><option value="">Live and test records</option><option value="test">Test only</option><option value="live">Live only</option></select></label><label>Verified method<select name="method" defaultValue={params.method??""}><option value="">All methods / unclassified</option>{Object.entries(netcashMethodLabels).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>{params.facilityId&&<input type="hidden" name="facilityId" value={params.facilityId}/>}<button className="button button-secondary">Apply payment filters</button></form><p>Nicole confirmed developer-account card subscriptions on 13 October. Upfront card/EFT, subscriptions, eMandates, standard debit orders, DebiCheck, payment requests, refunds and settlement have separate setup and approval stages. Production onboarding remains incomplete; enabling one service does not prove all services operational.</p></section>
    <section className="panel table-panel netcash-payments-panel">
      <div className="panel-heading"><div><h2>Recent Netcash payments</h2><p>Latest 250 attempts, newest first. Test authorisations stay visible here and do not enter live receipt totals.</p></div></div>
      <div className="table-wrap" role="region" aria-label="Recent Netcash payments" tabIndex={0}><table className="data-table"><thead><tr><th>Created</th><th>Customer / account</th><th>Payment</th><th>Provider reference</th><th>Outcome</th><th>Internal reconciliation</th></tr></thead><tbody>
        {rows.map(({ payment, evidence, reconciliation }) => {
          const customer = payment.account.customer;
          const name = customer.companyName || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer";
          const unit = (payment.providerFacilityId||payment.account.accountNumber.startsWith("ST24-T-"))?undefined:payment.account.tenancy?.occupancies[0]?.unit.number;
          const Icon = reconciliation.state === "MATCHED" ? CheckCircle2 : reconciliation.state === "PENDING" ? Clock3 : reconciliation.state === "FAILED" ? XCircle : AlertTriangle;
          return <tr key={payment.id}>
            <td>{payment.createdAt.toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"})}</td>
            <td><strong>{name}</strong><small>{payment.account.accountNumber}{unit ? ` · Unit ${unit}` : ""}</small></td>
            <td><strong>{money(payment.amount)}</strong><small>{payment.method.replaceAll("_", " ")}</small><small>{evidence?`${evidence.method} · verified ${new Date(evidence.checkedAt).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg"})} SAST`:"Selected method not yet verified"}</small><NetcashEvidenceAction paymentId={payment.id}/></td>
            <td><code>{payment.providerRef || payment.providerOriginalRef || "Awaiting reference"}</code></td>
            <td><span className={`status-pill ${payment.status === "SUCCEEDED" ? "success" : payment.status === "PENDING" ? "warning" : "neutral"}`}>{payment.status.replaceAll("_", " ")}</span>{payment.failureCode ? <small>{payment.failureCode}</small> : null}</td>
            <td><span className={`netcash-reconciliation-state ${stateClass[reconciliation.state]}`}><Icon size={14} />{stateLabel[reconciliation.state]}</span></td>
          </tr>;
        })}
        {!rows.length ? <tr><td colSpan={6} className="empty-cell"><CreditCard size={22} />No Netcash payment attempts are recorded for your permitted facilities.</td></tr> : null}
      </tbody></table></div>
    </section>
  </div>;
}

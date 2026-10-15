import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePermissionScope } from "@/lib/scope";
import { staffPaymentReviewQueue } from "@/lib/staff-payment-review-service";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export const metadata = { title: "Payments awaiting review" };
export const dynamic = "force-dynamic";
const labels = { AWAITING_CONFIRMATION: "Awaiting confirmation", SOURCE_REVIEW: "Source evidence needs review", MISSING_RECEIPT: "Receipt match missing", DUPLICATE_RECEIPT: "Multiple receipt matches" };
export default async function PaymentReviewPage({ searchParams }: { searchParams: Promise<{ facilityId?: string; cursor?: string }> }) {
  const scope = await requirePermissionScope("payments.view");
  const params = await searchParams;
  let result: Awaited<ReturnType<typeof staffPaymentReviewQueue>> | null = null;
  try { result = await staffPaymentReviewQueue(scope, params.facilityId, params.cursor); } catch (error) { if (error instanceof Error && ["FORBIDDEN", "FACILITY_FORBIDDEN", "UNAUTHENTICATED"].includes(error.message)) throw error; }
  const query = new URLSearchParams(params.facilityId ? { facilityId: params.facilityId } : {});
  if (result?.nextCursor) query.set("cursor", result.nextCursor);
  return <div className="page-stack"><PageHeader eyebrow="Operations centre" title="Payments awaiting review" description="Recorded pending payments and unresolved internal receipt evidence in your permitted stores. This queue does not establish bank settlement." action={<Link href="/operations" className="button button-secondary">Operations centre</Link>}/>
    <section className="panel panel-spacious payment-review-panel"><div className="panel-heading"><h2>Review queue</h2><Link className="button button-secondary" href={`/operations/payment-review${params.facilityId ? `?facilityId=${encodeURIComponent(params.facilityId)}` : ""}`}>Reload latest payments</Link></div>
      {!result ? <p role="alert">Payment review could not be loaded. Reload the latest payments before relying on this queue.</p> : <><p>Reviewed {result.scanned} recorded attempts on this page. Test records are excluded. Open the source workflow to investigate; unresolved items stay here until the source is corrected.</p><div className="work-list">{result.rows.map(row => <Link className="work-row" href={row.href} key={row.id}><span className="work-copy"><strong>{row.customer} · {labels[row.reason]}</strong><small>{row.facility} · {row.currency} {row.amount} · {formatSouthAfricaDateTime(row.createdAt)} SAST</small><small>{row.provider} · Record {row.id}</small></span><span>Review source →</span></Link>)}</div>{!result.rows.length ? <p>No unresolved payments in these {result.scanned} recorded attempts.</p> : null}{result.nextCursor ? <Link className="button button-secondary" href={`/operations/payment-review?${query.toString()}`}>Review older payments</Link> : null}</>}
    </section></div>;
}

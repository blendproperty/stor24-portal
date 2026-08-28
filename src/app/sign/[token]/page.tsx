import { notFound } from "next/navigation";
import { getLeaseForSigning } from "@/lib/leasing-service";
import { buildLeaseClauses } from "@/lib/lease-agreement-content";
import { LeaseSigningForm } from "@/components/lease-signing-form";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export const dynamic = "force-dynamic";

export default async function SignLeasePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const lease = await getLeaseForSigning(token);
  if (!lease) notFound();

  const clauses = buildLeaseClauses({
    facilityName: lease.facilityName,
    unitNumber: lease.unitNumber,
    customerName: lease.customerName,
    monthlyRate: lease.monthlyRate,
    startDate: lease.startDate,
  });

  return (
    <main
      style={{ maxWidth: 760, margin: "40px auto", padding: "0 16px 64px" }}
    >
      <div className="panel panel-spacious">
        <p className="eyebrow">Stor24 lease agreement</p>
        <h1>
          {lease.facilityName} · Unit {lease.unitNumber}
        </h1>
        <p className="lease-summary">
          Prepared for {lease.customerName}. Please read every clause, initial
          it, then sign at the bottom.
        </p>

        {lease.status === "SIGNED" ? (
          <div className="lease-signed-notice">
            <h2>Signed</h2>
            <p>
              This agreement was signed by {lease.signerName}
              {lease.signedAt
                ? ` on ${formatSouthAfricaDateTime(lease.signedAt)} SAST`
                : ""}
              . No further action is needed.
            </p>
          </div>
        ) : lease.expired ? (
          <div className="lease-signed-notice">
            <h2>This link has expired</h2>
            <p>Please contact Stor24 to have a new signing link sent to you.</p>
          </div>
        ) : (
          <LeaseSigningForm token={token} clauses={clauses} />
        )}
      </div>
    </main>
  );
}

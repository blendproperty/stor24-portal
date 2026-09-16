"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

type Submission = {
  id: string;
  customerName: string;
  facilityName: string;
  unitNumber: string | null;
  occupancyActive: boolean;
  submittedAt: string;
  waitHours: number;
};

export function FacialSubmissionQueue({ submissions }: { submissions: Submission[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function approve(id: string) {
    setBusyId(id);
    setMessage("");
    const response = await fetch(`/api/v1/access/facial-submissions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    const body = await response.json();
    setBusyId(null);
    setMessage(
      response.ok
        ? "Facial access was enrolled and verified by HikCentral."
        : (body.error?.message ?? "Enrolment failed."),
    );
    if (response.ok) router.refresh();
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting this photo (shown to the customer's follow-up task, not sent to them automatically):");
    if (!reason) return;
    setBusyId(id);
    setMessage("");
    const response = await fetch(`/api/v1/access/facial-submissions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", reason }),
    });
    const body = await response.json();
    setBusyId(null);
    setMessage(response.ok ? "Photo rejected." : (body.error?.message ?? "Rejection failed."));
    if (response.ok) router.refresh();
  }

  return (
    <section className="panel panel-spacious">
      <div className="panel-heading">
        <div>
          <h2>Self-service photo submissions awaiting staff review</h2>
          <p className="panel-subtitle">
            Verified, agreement-signed, paid customers who submitted a facial photo online. Approving here sends the photo to HikCentral for
            this specific unit only; it is only possible once the tenancy is fully active.
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Facility / unit</th>
              <th>Waiting</th>
              <th>Move-in status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.length ? (
              submissions.map((item) => (
                <tr key={item.id}>
                  <td className="primary-cell">{item.customerName}</td>
                  <td>
                    {item.facilityName} · {item.unitNumber ?? "—"}
                  </td>
                  <td>{formatSouthAfricaDateTime(item.submittedAt)} SAST ({item.waitHours}h)</td>
                  <td>
                    {item.occupancyActive
                      ? "Tenancy active — ready to activate access"
                      : "Awaiting Move In / lease signature"}
                  </td>
                  <td>
                    <div className="form-actions">
                      <button
                        className="button button-primary"
                        disabled={busyId === item.id || !item.occupancyActive}
                        onClick={() => approve(item.id)}
                      >
                        {busyId === item.id ? "Processing…" : "Approve & activate access"}
                      </button>
                      <button className="button button-secondary" disabled={busyId === item.id} onClick={() => reject(item.id)}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="empty-cell">
                  No self-service photo submissions are waiting.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {message ? <p className="safe-config-note">{message}</p> : null}
    </section>
  );
}

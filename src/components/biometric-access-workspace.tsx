"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

type Enrollment = {
  id: string;
  customerName: string;
  facilityName: string;
  unitNumber: string;
  status: string;
  consentAt: string;
  provisionedAt: string | null;
};

export function BiometricAccessWorkspace({
  enrollments,
}: {
  enrollments: Enrollment[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function revoke(enrollmentId: string) {
    if (!window.confirm("Revoke this person's biometric access now?")) return;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/v1/access/biometrics", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollmentId }),
    });
    const body = await response.json();
    setBusy(false);
    setMessage(
      response.ok
        ? "Biometric access was revoked."
        : (body.error?.message ?? "Revocation failed."),
    );
    if (response.ok) router.refresh();
  }

  if (!enrollments.length) return null;
  return (
    <div className="page-stack">
      <section className="panel panel-spacious">
        <div className="panel-heading">
          <div>
            <h2>Biometric access register</h2>
            <p className="panel-subtitle">
              Consent, provisioning and revocation are audit logged.
            </p>
          </div>
        </div>
        {message && <p role="status">{message}</p>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Facility / unit</th>
                <th>Status</th>
                <th>Consent</th>
                <th>Provisioned</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {enrollments.length ? (
                enrollments.map((item) => (
                  <tr key={item.id}>
                    <td className="primary-cell">{item.customerName}</td>
                    <td>
                      {item.facilityName} · {item.unitNumber}
                    </td>
                    <td>{item.status}</td>
                    <td>{formatSouthAfricaDateTime(item.consentAt)} SAST</td>
                    <td>
                      {item.provisionedAt
                        ? `${formatSouthAfricaDateTime(item.provisionedAt)} SAST`
                        : "—"}
                    </td>
                    <td>
                      {item.status === "ACTIVE" ? (
                        <button
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() => revoke(item.id)}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No biometric enrolments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

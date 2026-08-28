"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

type Candidate = {
  occupancyId: string;
  facilityId: string;
  customerId: string;
  label: string;
};
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
  candidates,
  enrollments,
}: {
  candidates: Candidate[];
  enrollments: Enrollment[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function enroll(formData: FormData) {
    setBusy(true);
    setMessage("");
    const selected = candidates.find(
      (candidate) => candidate.occupancyId === formData.get("occupancyId"),
    );
    if (!selected) {
      setBusy(false);
      setMessage("Select an active tenancy.");
      return;
    }
    formData.set("facilityId", selected.facilityId);
    formData.set("customerId", selected.customerId);
    formData.set("consent", formData.get("consent") ? "true" : "false");
    const response = await fetch("/api/v1/access/biometrics", {
      method: "POST",
      body: formData,
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error?.message ?? "Enrolment failed.");
      return;
    }
    setMessage("Facial access was enrolled and verified by HikCentral.");
    router.refresh();
  }

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

  return (
    <div className="page-stack">
      <section className="panel panel-spacious">
        <div className="panel-heading">
          <div>
            <h2>Enrol a tenant</h2>
            <p className="panel-subtitle">
              The face image is sent directly to HikCentral and is not retained
              in the CRM database.
            </p>
          </div>
        </div>
        <form action={enroll} className="customer-form">
          <label className="customer-form-wide">
            Active tenancy
            <select name="occupancyId" required defaultValue="">
              <option value="" disabled>
                Select customer, facility and unit
              </option>
              {candidates.map((candidate) => (
                <option
                  key={candidate.occupancyId}
                  value={candidate.occupancyId}
                >
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <label className="customer-form-wide">
            Clear facial photograph (JPEG or PNG, maximum 5 MB)
            <input
              name="faceImage"
              type="file"
              accept="image/jpeg,image/png"
              required
            />
          </label>
          <label className="check-label customer-form-wide">
            <input name="consent" type="checkbox" required />
            <span>
              I confirm that the customer gave explicit consent for their facial
              biometric to be used for Stor24 facility access, and that an
              alternative access method was explained.
            </span>
          </label>
          <div className="form-actions customer-form-wide">
            <button
              className="button button-primary"
              disabled={busy || !candidates.length}
            >
              {busy ? "Processing…" : "Enrol facial access"}
            </button>
          </div>
        </form>
        {message ? <p className="safe-config-note">{message}</p> : null}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Biometric access register</h2>
            <p className="panel-subtitle">
              Consent, provisioning and revocation are audit logged.
            </p>
          </div>
        </div>
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

import { StatusPill, type StatusTone } from "@/components/status-pill";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

type IdentityLinkRow = {
  id: string;
  customerName: string;
  melIntegrationLinkId: string | null;
  hikCentralPersonId: string | null;
  status: string;
  linkedAt: string | null;
  resolvedByName: string | null;
};

type AccessDecisionRow = {
  id: string;
  customerName: string;
  facilityName: string;
  unitNumber: string;
  action: string;
  source: string;
  state: string;
  reason: string;
  attempts: number;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

const identityLinkTone: Record<string, StatusTone> = {
  PENDING: "neutral",
  ACTIVE: "positive",
  DUPLICATE_SUSPECTED: "warning",
  MANUALLY_RESOLVED: "neutral",
  SUPERSEDED: "neutral",
};

const decisionStateTone: Record<string, StatusTone> = {
  DESIRED: "neutral",
  PENDING: "warning",
  CONFIRMED: "positive",
  FAILED: "danger",
  RECONCILIATION_REQUIRED: "danger",
};

export function MelIntegrationStatus({
  identityLinks,
  accessDecisions,
}: {
  identityLinks: IdentityLinkRow[];
  accessDecisions: AccessDecisionRow[];
}) {
  return (
    <div className="page-stack">
      <section className="panel panel-spacious">
        <div className="panel-heading">
          <div>
            <h2>MEL identity links</h2>
            <p className="panel-subtitle">
              Maps each customer to a proposed MEL IntegrationLinkID and HikCentral
              person, per docs/MEL_INTEGRATION_OWNERSHIP_MATRIX.md. No live MEL
              provider is connected yet, so this register only fills in once a
              real identity-linking flow is agreed and built — an empty table here
              is expected, not a fault.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>MEL IntegrationLinkID</th>
                <th>HikCentral person</th>
                <th>Status</th>
                <th>Linked</th>
                <th>Resolved by</th>
              </tr>
            </thead>
            <tbody>
              {identityLinks.length ? (
                identityLinks.map((link) => (
                  <tr key={link.id}>
                    <td className="primary-cell">{link.customerName}</td>
                    <td>{link.melIntegrationLinkId ?? "—"}</td>
                    <td>{link.hikCentralPersonId ?? "—"}</td>
                    <td>
                      <StatusPill tone={identityLinkTone[link.status] ?? "neutral"}>
                        {link.status}
                      </StatusPill>
                    </td>
                    <td>
                      {link.linkedAt ? `${formatSouthAfricaDateTime(link.linkedAt)} SAST` : "—"}
                    </td>
                    <td>{link.resolvedByName ?? "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No MEL identity links yet — no provider agreement is in place.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel panel-spacious">
        <div className="panel-heading">
          <div>
            <h2>Access decisions</h2>
            <p className="panel-subtitle">
              STOR24&apos;s own desired/pending/confirmed access-governance log
              (src/lib/access-decision-service.ts). This service is not yet wired
              into the live enrol/revoke or payment flows, so no rows are created
              by normal use today — this table exists so the workspace is ready
              the moment that wiring lands, without any change to how the
              existing HikCentral enrolment above behaves.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer / unit</th>
                <th>Action</th>
                <th>Source</th>
                <th>State</th>
                <th>Reason</th>
                <th>Attempts</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {accessDecisions.length ? (
                accessDecisions.map((decision) => (
                  <tr key={decision.id}>
                    <td className="primary-cell">
                      {decision.customerName} · {decision.facilityName} · Unit {decision.unitNumber}
                    </td>
                    <td>{decision.action}</td>
                    <td>{decision.source}</td>
                    <td>
                      <StatusPill tone={decisionStateTone[decision.state] ?? "neutral"}>
                        {decision.state}
                      </StatusPill>
                      {decision.failureCode ? (
                        <div className="panel-subtitle">{decision.failureCode}</div>
                      ) : null}
                    </td>
                    <td>{decision.reason}</td>
                    <td>{decision.attempts}</td>
                    <td>{formatSouthAfricaDateTime(decision.updatedAt)} SAST</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No access decisions recorded yet — this log fills in once
                    Stage 5 wiring is approved and built.
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

import {
  Activity,
  AlertTriangle,
  Cable,
  CheckCircle2,
  Clock3,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { db } from "@/lib/db";
import {
  classifyBlendSignLease,
  blendSignLeaseStateLabel,
  blendSignLeaseStateNeedsAction,
} from "@/lib/blendsign-reconciliation";
import { requirePermissionScope } from "@/lib/scope";
import { BlendSignReconciliationActions } from "@/components/blendsign-reconciliation-actions";
import { WhatsAppAutomationControl } from "@/components/whatsapp-automation-control";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import { getWhatsAppAutomationState } from "@/lib/integrations/whatsapp-automation";
import { requireSession } from "@/lib/auth-guards";
import {
  configuredMessagingChannels,
  messagingReadiness,
  type MessagingChannel,
} from "@/lib/integrations/messaging-readiness";
import { listHikCentralConfiguration } from "@/lib/integrations/hikcentral-configuration";
import { hikCentralReadiness } from "@/lib/integrations/hikcentral-readiness";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

function customerName(customer: {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}) {
  return (
    customer.companyName ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
    "Unnamed customer"
  );
}

export default async function IntegrationsPage() {
  const scope = await requirePermissionScope("operations.view");
  const facilityFilter = scope.unrestrictedFacilities
    ? {}
    : { facilityId: { in: scope.facilityIds } };
  const [
    session,
    whatsAppState,
    documents,
    inboxCounts,
    outboxCounts,
    hikCentralConfiguration,
    successfulDeliveries,
    successfulMessagingTests,
  ] = await Promise.all([
    requireSession(),
    getWhatsAppAutomationState(scope.organisationId),
    db.document.findMany({
      where: {
        provider: "BLENDSIGN",
        type: { in: ["LEASE_AGREEMENT", "LEASE_AGREEMENT_UAT"] },
        tenancy: {
          facility: { organisationId: scope.organisationId },
          ...facilityFilter,
        },
      },
      include: {
        tenancy: {
          include: {
            customer: true,
            account: true,
            facility: true,
            occupancies: {
              where: { status: { in: ["ACTIVE", "NOTICE_GIVEN", "PENDING"] } },
              include: { unit: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.webhookInbox.groupBy({
      by: ["status"],
      where: { organisationId: scope.organisationId },
      _count: true,
    }),
    db.webhookOutbox.groupBy({
      by: ["status"],
      where: { organisationId: scope.organisationId },
      _count: true,
    }),
    listHikCentralConfiguration(scope),
    db.communicationLog.findMany({
      where: {
        organisationId: scope.organisationId,
        channel: { in: ["EMAIL", "SMS", "WHATSAPP"] },
        status: "SUCCEEDED",
      },
      select: { channel: true },
      distinct: ["channel"],
    }),
    db.auditEvent.findMany({
      where: {
        organisationId: scope.organisationId,
        action: {
          in: [
            "communication.sms.test_succeeded",
            "communication.whatsapp.test_succeeded",
          ],
        },
      },
      select: { action: true },
      distinct: ["action"],
    }),
  ]);
  const rows = documents.map((document) => ({
    document,
    state: classifyBlendSignLease({
      status: document.status,
      externalId: document.externalId,
      createdAt: document.createdAt,
      expiresAt: document.expiresAt,
      tenancyStatus: document.tenancy.status,
    }),
  }));
  const completed = rows.filter((row) => row.state === "COMPLETED").length;
  const awaiting = rows.filter(
    (row) => row.state === "AWAITING_SIGNATURE" || row.state === "DISPATCHING",
  ).length;
  const actionRequired = rows.filter((row) =>
    blendSignLeaseStateNeedsAction(row.state),
  ).length;
  const inbox = Object.fromEntries(
    inboxCounts.map((item) => [item.status, item._count]),
  );
  const outbox = Object.fromEntries(
    outboxCounts.map((item) => [item.status, item._count]),
  );
  const accessControl = hikCentralReadiness(hikCentralConfiguration);
  const configuredChannels = configuredMessagingChannels(process.env);
  const verifiedChannels = new Set<MessagingChannel>(
    successfulDeliveries.flatMap((item) =>
      item.channel === "EMAIL"
        ? ["Email"]
        : item.channel === "SMS"
          ? ["SMS"]
          : item.channel === "WHATSAPP"
            ? ["WhatsApp"]
            : [],
    ),
  );
  if (
    successfulMessagingTests.some(
      (item) => item.action === "communication.sms.test_succeeded",
    )
  )
    verifiedChannels.add("SMS");
  if (
    successfulMessagingTests.some(
      (item) => item.action === "communication.whatsapp.test_succeeded",
    )
  )
    verifiedChannels.add("WhatsApp");
  const messaging = messagingReadiness(configuredChannels, verifiedChannels);
  const whatsAppConfigured = configuredChannels.has("WhatsApp");
  const connections = [
    [
      "BlendSign",
      "BlendSign",
      "Connected",
      "Lease envelopes and completed artifacts",
      "positive",
      null,
    ],
    [
      "Payments",
      "Netcash",
      "Configuration required",
      "Validate the dedicated test account; transaction processing stays disabled",
      "warning",
      "/settings/integrations/netcash",
    ],
    [
      "Access control",
      "Hikvision / HikCentral",
      accessControl.state,
      accessControl.detail,
      accessControl.tone,
      "/settings/integrations/hikvision",
    ],
    [
      "Email / messaging",
      "Email / Twilio",
      messaging.state,
      messaging.detail,
      messaging.tone,
      "/communications",
    ],
    [
      "Accounting",
      "MRI export queue",
      "Partial",
      "Integration method and chart mapping awaiting approval",
      "warning",
      null,
    ],
  ] as const;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Connection centre"
        title="Integrations & webhooks"
        description="Live provider state, lease-envelope reconciliation and delivery backlogs. Failures remain visible until resolved."
      />
      <section className="summary-strip">
        <div className="summary-cell">
          <span>Completed leases</span>
          <strong>{completed}</strong>
        </div>
        <div className="summary-cell">
          <span>Awaiting signature</span>
          <strong>{awaiting}</strong>
        </div>
        <div className="summary-cell">
          <span>Lease action required</span>
          <strong>{actionRequired}</strong>
        </div>
        <div className="summary-cell">
          <span>Dead-letter events</span>
          <strong>
            {(inbox.DEAD_LETTER ?? 0) + (outbox.DEAD_LETTER ?? 0)}
          </strong>
        </div>
      </section>
      <WhatsAppAutomationControl
        enabled={whatsAppState.enabled}
        serverGateEnabled={whatsAppState.serverGateEnabled}
        configured={whatsAppConfigured}
        canManage={session.role === "Organisation owner"}
      />
      <section className="panel integration-table">
        <div className="panel-heading">
          <div>
            <h2>BlendSign lease reconciliation</h2>
            <p className="panel-subtitle">
              The latest 100 facility-authorised lease documents, classified
              from persisted Stor24 state.
            </p>
          </div>
          <Activity className="muted-icon" />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Customer / unit</th>
                <th>Facility</th>
                <th>Document</th>
                <th>Operational state</th>
                <th>Sent / expires</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map(({ document, state }) => (
                  <tr key={document.id}>
                    <td>
                      <Link
                        className="primary-cell"
                        href={`/operations/accounts?accountId=${encodeURIComponent(document.tenancy.accountId)}`}
                      >
                        {document.tenancy.account.accountNumber}
                      </Link>
                    </td>
                    <td>
                      {customerName(document.tenancy.customer)}
                      <span className="secondary-cell">
                        Unit{" "}
                        {document.tenancy.occupancies[0]?.unit.number ?? "—"}
                      </span>
                    </td>
                    <td>{document.tenancy.facility.name}</td>
                    <td>
                      {document.templateKey ?? "Lease"}
                      <span className="secondary-cell">
                        {document.externalId ?? "No envelope ID"}
                      </span>
                    </td>
                    <td>
                      <StatusPill
                        tone={
                          blendSignLeaseStateNeedsAction(state)
                            ? "warning"
                            : state === "COMPLETED"
                              ? "positive"
                              : "neutral"
                        }
                      >
                        {blendSignLeaseStateLabel(state)}
                      </StatusPill>
                    </td>
                    <td>
                      {formatSouthAfricaDateTime(document.sentAt ?? document.createdAt)} SAST
                      <span className="secondary-cell">
                        {document.expiresAt
                          ? `Expires ${formatSouthAfricaDateTime(document.expiresAt)} SAST`
                          : "No expiry recorded"}
                      </span>
                    </td>
                    <td>
                      {state === "DISPATCH_FAILED" ? (
                        <BlendSignReconciliationActions
                          documentId={document.id}
                          action="retry-dispatch"
                        />
                      ) : state === "OVERDUE" ||
                        state === "AWAITING_SIGNATURE" ? (
                        <BlendSignReconciliationActions
                          documentId={document.id}
                          action="resend-invitation"
                        />
                      ) : state === "RECONCILIATION_REQUIRED" ? (
                        <Link
                          className="text-button"
                          href={`/operations/accounts?accountId=${encodeURIComponent(document.tenancy.accountId)}`}
                        >
                          Review account
                        </Link>
                      ) : (
                        <span className="secondary-cell">No action</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No BlendSign lease documents found in your authorised
                    facilities.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel integration-table">
        <div className="panel-heading">
          <div>
            <h2>Connection health</h2>
            <p className="panel-subtitle">
              Only integrations with production evidence are shown as connected.
            </p>
          </div>
          <Activity className="muted-icon" />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Provider</th>
                <th>State</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(
                ([category, provider, state, detail, tone, href]) => (
                  <tr key={category}>
                    <td className="primary-cell">{category}</td>
                    <td>
                      {href ? (
                        <Link className="primary-cell" href={href}>
                          {provider}
                        </Link>
                      ) : (
                        provider
                      )}
                    </td>
                    <td>
                      <StatusPill tone={tone}>{state}</StatusPill>
                    </td>
                    <td>
  {href ? (
    <Link className="text-button" href={href}>
      Configure
    </Link>
  ) : (
    detail
  )}
</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="dashboard-grid">
        <article className="panel panel-spacious">
          <div className="panel-heading">
            <div>
              <h2>Webhook inbox</h2>
              <p className="panel-subtitle">
                Persisted provider events by processing state.
              </p>
            </div>
            <Webhook className="muted-icon" />
          </div>
          <div className="state-list">
            <div>
              <Clock3 />
              <span>
                <strong>Pending / processing</strong>
                <small>
                  {(inbox.PENDING ?? 0) + (inbox.PROCESSING ?? 0)} events
                </small>
              </span>
            </div>
            <div>
              <CheckCircle2 />
              <span>
                <strong>Processed</strong>
                <small>{inbox.SUCCEEDED ?? 0} events</small>
              </span>
            </div>
            <div>
              <AlertTriangle />
              <span>
                <strong>Failed / dead letter</strong>
                <small>
                  {(inbox.FAILED ?? 0) + (inbox.DEAD_LETTER ?? 0)} events
                </small>
              </span>
            </div>
          </div>
        </article>
        <article className="panel panel-spacious">
          <div className="panel-heading">
            <div>
              <h2>Transactional outbox</h2>
              <p className="panel-subtitle">
                Persisted outbound finance and provider work by delivery state.
              </p>
            </div>
            <Cable className="muted-icon" />
          </div>
          <div className="state-list">
            <div>
              <Clock3 />
              <span>
                <strong>Pending / processing</strong>
                <small>
                  {(outbox.PENDING ?? 0) + (outbox.PROCESSING ?? 0)} deliveries
                </small>
              </span>
            </div>
            <div>
              <CheckCircle2 />
              <span>
                <strong>Delivered</strong>
                <small>{outbox.SUCCEEDED ?? 0} deliveries</small>
              </span>
            </div>
            <div>
              <AlertTriangle />
              <span>
                <strong>Failed / dead letter</strong>
                <small>
                  {(outbox.FAILED ?? 0) + (outbox.DEAD_LETTER ?? 0)} deliveries
                </small>
              </span>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

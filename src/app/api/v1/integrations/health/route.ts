import { requirePermission } from "@/lib/auth-guards";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const baseConnections = [
  { category: "Payments", provider: "Not selected", status: "CONFIG_REQUIRED", lastCheckedAt: null, backlog: 0, message: "Choose and credential an approved payment provider." },
  { category: "Email", provider: "Not selected", status: "CONFIG_REQUIRED", lastCheckedAt: null, backlog: 0, message: "Sender domain and provider credentials are required." },
  { category: "SMS", provider: "Not selected", status: "CONFIG_REQUIRED", lastCheckedAt: null, backlog: 0, message: "Sender identity and provider credentials are required." },
  { category: "Accounting", provider: "File export", status: "DEGRADED", lastCheckedAt: null, backlog: 2, message: "Mapping approval is outstanding; no vendor transmission occurs." },
  { category: "Website leads", provider: "Webhook inbox", status: "CONFIG_REQUIRED", lastCheckedAt: null, backlog: 0, message: "Register a source and signing secret before accepting events." },
];

export async function GET() {
  const session = await requirePermission("integrations.view");
  const scope = session.allowedFacilityIds ? { OR: [{ facilityId: null }, { facilityId: { in: session.allowedFacilityIds } }] } : {};
  const hikConnections = await db.integrationConnection.findMany({ where: { organisationId: session.organisationId, category: "ACCESS_CONTROL", provider: "HIKCENTRAL", ...scope }, select: { facilityId: true, status: true, lastHealthAt: true, lastSuccessAt: true, failureMessage: true } });
  const company = hikConnections.find((item) => item.facilityId === null);
  const facilities = hikConnections.filter((item) => item.facilityId !== null);
  const connectedFacilities = facilities.filter((item) => item.status === "CONNECTED");
  const access = { category: "Access control", provider: "Hikvision / HikCentral", status: company?.status === "CONNECTED" && connectedFacilities.length ? "CONNECTED" : company ? "CONFIGURED" : "CONFIG_REQUIRED", lastCheckedAt: company?.lastHealthAt ?? null, backlog: 0, message: connectedFacilities.length ? `${connectedFacilities.length} facility connection verified.` : company?.failureMessage ?? "Add credentials, map a facility and run a live connection test." };
  return Response.json({ data: [baseConnections[0], access, ...baseConnections.slice(1)], meta: { role: session.role, liveChecksPerformed: Boolean(company?.lastHealthAt) } });
}

import { db } from "@/lib/db";

export const WHATSAPP_CONNECTION = { category: "MESSAGING", provider: "TWILIO_WHATSAPP" } as const;

function configEnabled(config: unknown) {
  return Boolean(config && typeof config === "object" && !Array.isArray(config) && (config as Record<string, unknown>).automationEnabled === true);
}

export function whatsAppServerGateEnabled() {
  return process.env.WHATSAPP_AUTOMATION_ENABLED === "true";
}

export async function getWhatsAppAutomationState(organisationId: string) {
  const connection = await db.integrationConnection.findFirst({
    where: { organisationId, facilityId: null, ...WHATSAPP_CONNECTION },
    orderBy: { createdAt: "asc" },
  });
  const requestedEnabled = configEnabled(connection?.config);
  const serverGateEnabled = whatsAppServerGateEnabled();
  return { connection, requestedEnabled, serverGateEnabled, enabled: requestedEnabled && serverGateEnabled };
}

export async function setWhatsAppAutomationState(input: { organisationId: string; actorId: string; enabled: boolean }) {
  const existing = await db.integrationConnection.findFirst({
    where: { organisationId: input.organisationId, facilityId: null, ...WHATSAPP_CONNECTION },
    orderBy: { createdAt: "asc" },
  });
  const previousConfig = existing?.config && typeof existing.config === "object" && !Array.isArray(existing.config)
    ? existing.config as Record<string, unknown> : {};
  const before = configEnabled(previousConfig);
  const connection = existing
    ? await db.integrationConnection.update({ where: { id: existing.id }, data: { config: { ...previousConfig, automationEnabled: input.enabled } } })
    : await db.integrationConnection.create({ data: { organisationId: input.organisationId, category: WHATSAPP_CONNECTION.category, provider: WHATSAPP_CONNECTION.provider, status: "CONFIGURED", config: { automationEnabled: input.enabled } } });
  await db.auditEvent.create({ data: {
    organisationId: input.organisationId,
    actorId: input.actorId,
    action: input.enabled ? "integration.whatsapp.automation.enabled" : "integration.whatsapp.automation.disabled",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    before: { automationEnabled: before },
    after: { automationEnabled: input.enabled },
  } });
  return { requestedEnabled: input.enabled, serverGateEnabled: whatsAppServerGateEnabled(), enabled: input.enabled && whatsAppServerGateEnabled() };
}

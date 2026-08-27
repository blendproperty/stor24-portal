type HikCentralStatus = "DISCONNECTED" | "DISABLED" | "CONFIGURED" | "CONNECTED" | "CONFIG_REQUIRED" | "HEALTHY" | "DEGRADED" | "FAILED";

type HikCentralReadinessInput = {
  company: {
    endpoint: string;
    appKeyConfigured: boolean;
    appSecretConfigured: boolean;
    status: HikCentralStatus;
    failureMessage: string | null;
  };
  facilities: Array<{
    name: string;
    organisationIndexCode: string;
    doorIndexCodes: string[];
    status: HikCentralStatus;
    failureMessage: string | null;
  }>;
};

export function hikCentralReadiness(configuration: HikCentralReadinessInput) {
  const credentialsReady = Boolean(configuration.company.endpoint && configuration.company.appKeyConfigured && configuration.company.appSecretConfigured);
  const mappedFacilities = configuration.facilities.filter((facility) => facility.organisationIndexCode && facility.doorIndexCodes.length);
  const connectedFacilities = mappedFacilities.filter((facility) => facility.status === "CONNECTED");
  const failedFacility = mappedFacilities.find((facility) => facility.status === "DEGRADED" || facility.status === "FAILED");

  if (configuration.company.status === "CONNECTED" && connectedFacilities.length) {
    return { state: "Connected", detail: `${connectedFacilities.length} facility connection${connectedFacilities.length === 1 ? "" : "s"} verified`, tone: "positive" } as const;
  }
  if (configuration.company.status === "DEGRADED" || configuration.company.status === "FAILED" || failedFacility) {
    return { state: "Connection failed", detail: failedFacility?.failureMessage || configuration.company.failureMessage || "The latest HikCentral live test failed", tone: "warning" } as const;
  }
  if (!credentialsReady) {
    return { state: "Configuration required", detail: "Add the HikCentral server address, App Key and App Secret", tone: "warning" } as const;
  }
  if (!mappedFacilities.length) {
    return { state: "Configuration required", detail: "Map a facility organisation and at least one door index code", tone: "warning" } as const;
  }
  return { state: "Ready to test", detail: `${mappedFacilities.length} facility mapping${mappedFacilities.length === 1 ? " is" : "s are"} ready for a live connection test`, tone: "warning" } as const;
}

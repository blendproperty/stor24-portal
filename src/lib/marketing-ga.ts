import { importPKCS8, SignJWT } from "jose";
export type MarketingTraffic = {
  status: "connected" | "unconfigured" | "unavailable";
  message: string;
  days: { date: string; sessions: number; views: number }[];
  totals: { sessions: number; views: number; users: number } | null;
};
// A dedicated read-only service account. Never return tokens or credential details to the browser.
export async function marketingTraffic(
  from: string,
  to: string,
): Promise<MarketingTraffic> {
  const credentials = process.env.GA4_SERVICE_ACCOUNT_JSON,
    property = process.env.GA4_PROPERTY_ID;
  if (!credentials || !property)
    return {
      status: "unconfigured",
      message:
        "Google Analytics reporting needs a read-only connection. Website tracking remains consent controlled.",
      days: [],
      totals: null,
    };
  try {
    if (!/^\d+$/.test(property)) throw Error("Invalid property");
    const account = JSON.parse(credentials) as {
      client_email: string;
      private_key: string;
    };
    if (!account.client_email?.endsWith(".gserviceaccount.com"))
      throw Error("Invalid account");
    const key = await importPKCS8(account.private_key, "RS256");
    const assertion = await new SignJWT({
      scope: "https://www.googleapis.com/auth/analytics.readonly",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(account.client_email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
    const auth = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!auth.ok) throw Error("Authentication failed");
    const { access_token } = await auth.json();
    async function report(dimensions: string[], metrics: string[]) {
      const response = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: from, endDate: to }],
            dimensions: dimensions.map((name) => ({ name })),
            metrics: metrics.map((name) => ({ name })),
            orderBys: dimensions.length
              ? [{ dimension: { dimensionName: "date" } }]
              : [],
            limit: 366,
          }),
          signal: AbortSignal.timeout(10000),
          cache: "no-store",
        },
      );
      if (!response.ok) throw Error("Report unavailable");
      return response.json() as Promise<{
        rows?: {
          dimensionValues?: { value: string }[];
          metricValues: { value: string }[];
        }[];
      }>;
    }
    const [daily, total] = await Promise.all([
      report(["date"], ["sessions", "screenPageViews"]),
      report([], ["sessions", "screenPageViews", "totalUsers"]),
    ]);
    const values = total.rows?.[0]?.metricValues;
    return {
      status: "connected",
      message:
        "Consented public website traffic from Google Analytics. Property-wide; not filtered by store. Figures may be delayed or thresholded.",
      days: (daily.rows ?? []).map((row) => {
        const d = row.dimensionValues?.[0]?.value ?? "";
        return {
          date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          sessions: Number(row.metricValues[0].value),
          views: Number(row.metricValues[1].value),
        };
      }),
      totals: {
        sessions: Number(values?.[0]?.value ?? 0),
        views: Number(values?.[1]?.value ?? 0),
        users: Number(values?.[2]?.value ?? 0),
      },
    };
  } catch {
    return {
      status: "unavailable",
      message:
        "Google Analytics reporting could not be retrieved. CRM results remain available. Check the reporting connection and retry.",
      days: [],
      totals: null,
    };
  }
}

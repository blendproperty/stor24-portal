import { importPKCS8, SignJWT } from "jose";

export const ABC_FUNNELS = {
  booking: [["booking_started", "Unit finder opened"], ["price_viewed", "Units & prices viewed"], ["select_unit", "Unit selected"], ["booking_details_started", "Customer details opened"], ["reservation_requested", "Reservation saved"]],
  enquiry: [["enquiry_form_started", "Enquiry started"], ["enquiry_submit", "Enquiry submitted"], ["generate_lead", "Enquiry saved"]],
} as const;
export type ABCRows = { dimensions: string[]; metrics: number[] }[];
export type ABCReport = { status: "connected" | "unavailable"; rows: ABCRows; limited: boolean; caveats: string[] };
export type ABCFunnel = { status: "connected" | "unavailable"; steps: { name: string; users: number; abandoned: number; abandonmentRate: number }[]; caveats: string[] };
export type MarketingABC = {
  status: "connected" | "unconfigured" | "unavailable"; retrievedAt: string | null;
  totals: ABCReport; previous: ABCReport; comparisonPeriod: {from:string;to:string} | null; daily: ABCReport; acquisition: ABCReport; pages: ABCReport; events: ABCReport; devices: ABCReport; conversionPages: ABCReport; clicks: ABCReport;
  funnels: { booking: ABCFunnel; enquiry: ABCFunnel };
};
const missingReport = (): ABCReport => ({ status: "unavailable", rows: [], limited: false, caveats: [] });
const missingFunnel = (): ABCFunnel => ({ status: "unavailable", steps: [], caveats: [] });
export function missingABC(status: MarketingABC["status"]): MarketingABC {
  return { status, retrievedAt: null, totals: missingReport(), previous:missingReport(), comparisonPeriod:null, daily:missingReport(), acquisition: missingReport(), pages: missingReport(), events: missingReport(), devices: missingReport(), conversionPages: missingReport(), clicks: missingReport(), funnels: { booking: missingFunnel(), enquiry: missingFunnel() } };
}
type RawReport = {
  dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string }[];
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  rowCount?: number; metadata?: { subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean; samplingMetadatas?: unknown[]; timeZone?: string };
};
function number(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") throw Error("INVALID_METRIC");
  const n = Number(value); if (!Number.isFinite(n) || n < 0) throw Error("INVALID_METRIC"); return n;
}
function caveats(body: RawReport) {
  return [body.metadata?.subjectToThresholding ? "Privacy thresholds may suppress results." : "", body.metadata?.dataLossFromOtherRow ? "Some values are grouped into (other)." : "", body.metadata?.samplingMetadatas?.length ? "Google sampled this report." : "", body.metadata?.timeZone ? `Google property time zone: ${body.metadata.timeZone}.` : ""].filter(Boolean);
}
export function parseABCReport(body: RawReport, dimensions: number, metrics: number): ABCReport {
  const rows = (body.rows ?? []).map(row => {
    if ((row.dimensionValues?.length ?? 0) !== dimensions || row.metricValues?.length !== metrics) throw Error("INVALID_REPORT");
    return { dimensions: (row.dimensionValues ?? []).map(d => String(d.value).slice(0, 160)), metrics: row.metricValues.map(m => number(m.value)) };
  });
  return { status: "connected", rows, limited: (body.rowCount ?? rows.length) > rows.length, caveats: caveats(body) };
}
export function parseABCFunnel(body: { funnelTable?: RawReport }, names: readonly (readonly [string, string])[]): ABCFunnel {
  const table = body.funnelTable; if (!table) throw Error("INVALID_FUNNEL");
  const stepIndex = table.dimensionHeaders?.findIndex(h => h.name === "funnelStepName") ?? -1;
  const metricIndex = (name: string) => table.metricHeaders?.findIndex(h => h.name === name) ?? -1;
  const users = metricIndex("activeUsers"), abandoned = metricIndex("funnelStepAbandonments"), rate = metricIndex("funnelStepAbandonmentRate");
  if ([stepIndex, users, abandoned, rate].some(i => i < 0)) throw Error("INVALID_FUNNEL_HEADERS");
  const steps = names.map(([, name], i) => {
    const matches = (table.rows ?? []).filter(row => row.dimensionValues?.[stepIndex]?.value === `${i + 1}. ${name}`);
    if (!(table.rows ?? []).length) return {name, users:0, abandoned:0, abandonmentRate:0};
    if (matches.length !== 1) throw Error("INCOMPLETE_FUNNEL");
    const row = matches[0];
    const u = number(row.metricValues?.[users]?.value), a = number(row.metricValues?.[abandoned]?.value), r = number(row.metricValues?.[rate]?.value);
    if (a > u || r > 1) throw Error("INVALID_FUNNEL_VALUES");
    return { name, users: u, abandoned: a, abandonmentRate: r };
  });
  if (steps.some((s, i) => i > 0 && s.users > steps[i - 1].users)) throw Error("INVALID_CLOSED_FUNNEL");
  return { status: "connected", steps, caveats: caveats(table) };
}
export type ABCFilters = { channel?: string; source?: string; campaign?: string; device?: string };
export function abcFilter(filters: ABCFilters) {
  const exact = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
  const expressions = [exact("hostName", "stor24.co.za")];
  for (const [key, field] of [["channel", "sessionDefaultChannelGroup"], ["source", "sessionSourceMedium"], ["campaign", "sessionCampaignName"], ["device", "deviceCategory"]] as const) {
    const value = filters[key]; if (value) { if (value.length > 160 || /[\r\n\x00]/.test(value)) throw Error("INVALID_FILTER"); expressions.push(exact(field, value)); }
  }
  return { andGroup: { expressions } };
}
export async function marketingABC(from: string, to: string, filters: ABCFilters = {}): Promise<MarketingABC> {
  const credentials = process.env.GA4_SERVICE_ACCOUNT_JSON, property = process.env.GA4_PROPERTY_ID;
  if (!credentials || !property) return missingABC("unconfigured");
  try {
    if (!/^\d+$/.test(property)) throw Error("INVALID_PROPERTY");
    const account = JSON.parse(credentials);
    if (!account.client_email?.endsWith(".gserviceaccount.com")) throw Error("INVALID_ACCOUNT");
    const key = await importPKCS8(account.private_key, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/analytics.readonly" }).setProtectedHeader({ alg: "RS256" }).setIssuer(account.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("5m").sign(key);
    const auth = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!auth.ok) throw Error("AUTH_FAILED");
    const { access_token } = await auth.json(); if (typeof access_token !== "string") throw Error("AUTH_FAILED");
    const dimensionFilter = abcFilter(filters), dateRanges = [{ startDate: from, endDate: to }];
    async function request(method: "runReport" | "runFunnelReport", body: object) {
      const response = await fetch(`https://analyticsdata.googleapis.com/${method === "runReport" ? "v1beta" : "v1alpha"}/properties/${property}:${method}`, { method: "POST", headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ dateRanges, dimensionFilter, ...body }), signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!response.ok) throw Error("REPORT_FAILED"); return response.json();
    }
    async function report(dimensions: string[], metrics: string[], eventNames?: string[], period?: {from:string;to:string}): Promise<ABCReport> {
      try { return parseABCReport(await request("runReport", { ...(period ? {dateRanges:[{startDate:period.from,endDate:period.to}]} : {}), dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })), ...(eventNames ? {dimensionFilter:{andGroup:{expressions:[dimensionFilter,{filter:{fieldName:"eventName",inListFilter:{values:eventNames}}}]}}} : {}), limit: "100", orderBys: [{ metric: { metricName: metrics[0] }, desc: true }] }), dimensions.length, metrics.length); } catch { return missingReport(); }
    }
    async function funnel(names: readonly (readonly [string, string])[]): Promise<ABCFunnel> {
      try { return parseABCFunnel(await request("runFunnelReport", { funnel: { isOpenFunnel: false, steps: names.map(([eventName, name], i) => ({ name, filterExpression: { funnelEventFilter: { eventName } }, ...(i ? { withinDurationFromPriorStep: "1800s" } : {}) })) }, limit: "100" }), names); } catch { return missingFunnel(); }
    }
    const duration = new Date(to).getTime()-new Date(from).getTime()+86400000;
    const comparisonPeriod = {from:new Date(new Date(from).getTime()-duration).toISOString().slice(0,10),to:new Date(new Date(from).getTime()-86400000).toISOString().slice(0,10)};
    const [totals, previous, daily, acquisition, pages, events, devices, conversionPages, clicks, booking, enquiry] = await Promise.all([
      report([], ["sessions", "totalUsers", "screenPageViews", "engagedSessions", "engagementRate", "averageSessionDuration", "userEngagementDuration"]),
      report([], ["sessions", "totalUsers", "screenPageViews", "engagedSessions", "engagementRate", "averageSessionDuration", "userEngagementDuration"], undefined, comparisonPeriod),
      report(["date"], ["sessions", "engagedSessions"]),
      report(["sessionDefaultChannelGroup", "sessionSourceMedium", "sessionCampaignName"], ["sessions", "engagedSessions", "engagementRate", "keyEvents"]),
      report(["pagePath"], ["screenPageViews", "activeUsers", "userEngagementDuration"]),
      report(["eventName"], ["eventCount", "totalUsers"]),
      report(["deviceCategory"], ["sessions", "engagementRate", "averageSessionDuration"]),
      report(["pagePath", "eventName"], ["eventCount", "totalUsers"], ["generate_lead", "reservation_requested", "enquiry_error", "booking_error", "enquiry_delivery_pending"]),
      report(["pagePath", "eventName", "linkText", "linkUrl"], ["eventCount", "totalUsers"], ["public_link_click", "public_button_click", "contact_click", "booking_cta_click"]),
      funnel(ABC_FUNNELS.booking), funnel(ABC_FUNNELS.enquiry),
    ]);
    const publicPaths = new Set(["/micro-warehousing", "/", "/personal-storage", "/business-storage", "/student-storage", "/moving-storage", "/storage-unit-sizes", "/space-guide", "/storage/midpoint", "/storage/melrose", "/contact", "/faq", "/blog", "/storage-insights", "/terms", "/privacy", "/paia", "/book", "/micro-warehousing/book"]);
    const safePage = (path: string) => publicPaths.has(path) || /^\/(?:blog|storage-insights)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
    pages.rows = pages.rows.filter(row => safePage(row.dimensions[0]));
    conversionPages.rows = conversionPages.rows.filter(row => safePage(row.dimensions[0]) && ["generate_lead", "reservation_requested", "enquiry_error", "booking_error", "enquiry_delivery_pending"].includes(row.dimensions[1]));
    clicks.rows = clicks.rows.filter(row => safePage(row.dimensions[0]) && (row.dimensions[3] === "(not set)" || row.dimensions[3] === "" || (row.dimensions[3].startsWith("https://stor24.co.za/") && safePage(row.dimensions[3].slice(20)))));
    const safeActions = new Set(["Play", "Pause", "Pack My Unit", "Reset", "View units & prices", "Send my quote request", "Send enquiry", "Navigate", "phone", "email", "whatsapp", "(not set)", ""]);
    clicks.rows = clicks.rows.map(row => ({...row, dimensions:row.dimensions.map((value,i)=>i===2 && !safeActions.has(value) ? "Unlabelled public action" : value)}));
    daily.rows = daily.rows.sort((a,b)=>a.dimensions[0].localeCompare(b.dimensions[0]));
    return { status: [totals, previous, daily, acquisition, pages, events, devices, conversionPages, clicks, booking, enquiry].some(r => r.status === "connected") ? "connected" : "unavailable", retrievedAt: new Date().toISOString(), totals, previous, comparisonPeriod, daily, acquisition, pages, events, devices, conversionPages, clicks, funnels: { booking, enquiry } };
  } catch { return missingABC("unavailable"); }
}

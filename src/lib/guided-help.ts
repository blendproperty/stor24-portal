import { extendedGuides, extendedPageHelp } from "./guided-help-catalog";
/** Editorial guidance only. Progress records reading, never operational completion. */
export type GuideStep = {
  id: string;
  title: string;
  body: string;
  route: string;
  screen: string;
  target: string;
  missing: string;
  caution?: string;
  selector?: string;
  routePattern?: string;
};

export type WorkflowGuide = {
  id: string;
  title: string;
  description: string;
  duration: string;
  steps: GuideStep[];
  category?: string;
};

export const workflowGuides: WorkflowGuide[] = [
  {
    id: "orientation", title: "Find your way around", duration: "3 min",
    description: "Get to know your dashboard and where daily work begins.",
    steps: [
      { id: "overview", title: "Start with the operational overview", route: "/", screen: "Dashboard", target: "dashboard-metrics",
        body: "The dashboard brings occupancy, receivables and active leads together. Use it to understand the position across the facilities you can access before opening individual records.",
        missing: "Open the Dashboard to see the portfolio metrics." },
      { id: "priorities", title: "Work through what needs attention", route: "/", screen: "Dashboard", target: "dashboard-queue",
        body: "The priority work queue links to reservations approaching expiry, operational tasks and lead follow-ups. Open a queue to review the underlying records and decide the next action.",
        missing: "The priority work queue appears on the Dashboard." },
      { id: "navigation", title: "Follow the customer journey", route: "/", screen: "Dashboard", target: "workspace-navigation",
        body: "Use Lead to lease for enquiries, Reservations for holds, and Operations for move-in and other daily tasks. Tenants, Billing & payments and Collections support the ongoing account. Your permissions still determine what you can do.",
        missing: "The workspace menu is on the left on desktop. If it is hidden on your smaller screen, use the page links or return on a wider screen to review the full menu." },
      { id: "activity", title: "Check what actually happened", route: "/", screen: "Dashboard", target: "dashboard-activity",
        body: "Recent operational activity records staff and system actions, with their time and facility. Use the actual record and audit evidence when checking work; a tutorial tick only means you have read a step.",
        missing: "Open the Dashboard to see recent operational activity." },
    ],
  },
  {
    id: "reservations", title: "Manage a reservation", duration: "4 min",
    description: "Find a hold, understand its dates and prepare the move-in handoff.",
    steps: [
      { id: "find", title: "Find the right customer and store", route: "/reservations", screen: "Reservations", target: "reservation-filters",
        body: "Select the store, choose a status and search by customer, unit or unit type. The default list shows active reservations. Change the status filter if you are looking for a converted, cancelled or expired hold.",
        missing: "Open Reservations. If access is denied, ask your administrator for the appropriate store permissions." },
      { id: "review", title: "Review the hold before acting", route: "/reservations", screen: "Reservations", target: "reservation-list",
        body: "Check the customer, unit, quoted rate, hold expiry and intended move-in. A reservation holds a unit; it does not by itself confirm payment, occupancy or permission to collect keys.",
        missing: "The reservation list appears below the filters. An empty list may simply mean no records match." },
      { id: "create", title: "Create a hold when it is needed", route: "/reservations", screen: "Reservations", target: "reservation-create",
        body: "New reservation opens a form for the store, existing customer, available unit, quoted monthly rate and dates. The button needs an available unit and a customer record. Review the form carefully before choosing Reserve unit.",
        caution: "Reserve unit creates a real hold. To explore without saving, open the form and then choose Cancel.",
        missing: "Use New reservation at the top of the page. If disabled, check customer records and unit availability." },
      { id: "maintain", title: "Keep the hold accurate", route: "/reservations", screen: "Reservations", target: "reservation-list",
        body: "Extend asks for a later expiry date and a reason. Expire is for an overdue active hold. Cancel ends a reservation. Read the confirmation and resulting message: a unit can remain protected by another reservation or occupancy.",
        caution: "Extend, Expire and Cancel change live records. Only use them for a confirmed operational reason.",
        missing: "Actions appear on active reservation rows. They will not appear when the list is empty or a different status is selected." },
      { id: "handoff", title: "Carry the reservation into move-in", route: "/reservations", screen: "Reservations", target: "reservation-list",
        body: "Choose Move in beside the correct reservation to carry its customer and unit into the next screen. Signed bookings use the saved agreement and move-in checks. The Prepare a move-in guide explains that next stage.",
        missing: "Find an active reservation first, then use its Move in link. Do not create a duplicate reservation for training." },
    ],
  },
  {
    id: "move-in", title: "Prepare a move-in", duration: "5 min",
    description: "Follow the booking into agreement, payment and key-handover checks.",
    steps: [
      { id: "booking", title: "Start from the existing reservation", route: "/reservations", screen: "Reservations", target: "reservation-list",
        body: "Find the correct customer and unit, then choose Move in on that reservation. This carries the booking into the move-in screen. If you already opened Move in, continue to the next guide step.",
        missing: "Open Reservations to choose an active booking, or continue if you are already on its Move-in screen." },
      { id: "path", title: "Confirm the customer and the booking path", route: "/operations/move-in", screen: "Move in", target: "move-in-workspace",
        body: "A signed reservation opens Move-in checks and shows the customer and unit. Other bookings use Select unit and Account details to prepare the agreement. Always verify that you are working on the intended customer's booking.",
        missing: "Choose Move in from the reservation row. If you open the screen directly, select the correct unit and review its linked reservation." },
      { id: "agreement", title: "Use the agreement already on file", route: "/operations/move-in", screen: "Move in", target: "handover-agreement",
        body: "For a signed booking, View signed agreement opens the original document. No new signature is required. If the booking is not yet signed, review the Account details and agreement workflow instead; do not treat it as ready for key collection.",
        caution: "Sending an unsigned lease is a separate, deliberate action. This guide never sends an agreement or message.",
        missing: "This card appears for a signed reservation. If you see Account details, the booking is on the unsigned agreement path; review those details before sending anything." },
      { id: "payment", title: "Check eligible payment and the agreed date", route: "/operations/move-in", screen: "Move in", target: "handover-checks",
        body: "Review the verified amount against the amount required, the agreed move-in date and any listed blockers. A sandbox payment does not clear a real booking. A debit-order mandate is not proof of payment. Refresh checks after an authorised update.",
        caution: "Record a receipt only for actual confirmed funds and with the required evidence. Never enter a receipt merely to clear a training step.",
        missing: "Payment and date checks appear after selecting a signed reservation. They may be blocked; follow the stated reason rather than bypassing it." },
      { id: "keys", title: "Record handover only when it happens", route: "/operations/move-in", screen: "Move in", target: "handover-actions",
        body: "When the checks permit it, verify the customer's identity and unit at the physical handover. The attestation and Confirm move-in / key handover record that real event. A disabled button means a requirement remains outstanding.",
        caution: "Do not tick the handover attestation or confirm a move-in as a tutorial exercise. Facial access is handled separately.",
        missing: "The handover actions appear for signed bookings. Use the account-details path for an unsigned booking; no key handover is implied." },
      { id: "follow-up", title: "Check the outcome and separate access work", route: "/operations/move-in", screen: "Move in", target: "move-in-workspace",
        body: "After an actual successful handover, review the resulting tenancy and occupancy in the relevant records. Facial access has its own checks and operational approval. Finishing this guide confirms reading only; it does not confirm a payment, key collection or working door access.",
        missing: "You can finish reading this guide without changing any booking." },
    ],
  },
  ...extendedGuides,
];

export type PageHelp = { route: string; title: string; body: string; guideId?: string };
export const pageHelp: PageHelp[] = [
  ...extendedPageHelp,
  { route: "/operations/move-in", title: "Move in", body: "Start from the correct reservation. Signed bookings use the original agreement, verified payment and date checks before physical key handover.", guideId: "move-in" },
  { route: "/reservations", title: "Reservations & holds", body: "Filter by store and status, check hold dates, then use the reservation's Move in link to carry its details forward.", guideId: "reservations" },
  { route: "/", title: "Your operational overview", body: "Review portfolio metrics and the priority work queue, then open the records that need attention.", guideId: "orientation" },
];

export function helpForPath(pathname: string): PageHelp {
  if (/^\/operations\/accounts\/[^/]+\/statement$/.test(pathname)) return extendedPageHelp.find(page => page.guideId === "statements")!;
  return pageHelp.find((page) => page.route === pathname) ??
    pageHelp.filter((page) => page.route !== "/").sort((a, b) => b.route.length - a.route.length)
      .find((page) => pathname.startsWith(`${page.route}/`)) ??
    { route: pathname, title: "Help with this page", body: "Review this page's heading and instructions, and check the facility and record before saving. For customer booking tasks, use a workflow guide below. Ask your administrator if an action is unavailable." };
}

export function stepMatchesPath(step: GuideStep, pathname: string) {
  return step.routePattern ? new RegExp(step.routePattern).test(pathname) : step.route === pathname;
}

export function filterGuides(query: string, category = "All") {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return workflowGuides.filter(guide => (category === "All" || (guide.category ?? "Customer journey") === category) && words.every(word =>
    [guide.title, guide.description, guide.category, ...guide.steps.map(step => `${step.title} ${step.body}`)].join(" ").toLowerCase().includes(word)));
}

export type GuideProgress = { step: number; reviewed: string[] };
export type GuidePreferences = { version: 1; enabled: boolean; activeGuide: string | null; progress: Record<string, GuideProgress> };
export const emptyGuidePreferences: GuidePreferences = { version: 1, enabled: false, activeGuide: null, progress: {} };

export function guideStorageKey(userId: string) { return `stor24:guided-help:v1:${encodeURIComponent(userId)}`; }

/** Browser state is untrusted; only known guide and step IDs can be restored. */
export function parseGuidePreferences(raw: string | null): GuidePreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1) return { ...emptyGuidePreferences, progress: {} };
    const progress: Record<string, GuideProgress> = {};
    for (const guide of workflowGuides) {
      const item = value.progress?.[guide.id];
      if (!item || typeof item !== "object") continue;
      progress[guide.id] = {
        step: Number.isInteger(item.step) ? Math.max(0, Math.min(item.step, guide.steps.length - 1)) : 0,
        reviewed: guide.steps.filter(step => Array.isArray(item.reviewed) && item.reviewed.includes(step.id)).map(step => step.id),
      };
    }
    return { version: 1, enabled: value.enabled === true, activeGuide: workflowGuides.some(g => g.id === value.activeGuide) ? value.activeGuide : null, progress };
  } catch { return { ...emptyGuidePreferences, progress: {} }; }
}

export function reviewGuideStep(preferences: GuidePreferences, guideId: string, index: number): GuidePreferences {
  const guide = workflowGuides.find(item => item.id === guideId);
  const step = guide?.steps[index];
  if (!guide || !step) return preferences;
  const previous = preferences.progress[guideId]?.reviewed ?? [];
  return { ...preferences, activeGuide: guideId, progress: { ...preferences.progress,
    [guideId]: { step: Math.min(index + 1, guide.steps.length - 1), reviewed: Array.from(new Set([...previous, step.id])) },
  } };
}

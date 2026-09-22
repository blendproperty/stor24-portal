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

export type PageHelp = { route: string; title: string; body: string; guideId?: string };
export type GuideCatalogue = { guides: WorkflowGuide[]; pages: PageHelp[] };
export function genericPageHelp(route: string): PageHelp { return {route, title: "Help with this page", body: "Choose from the workflows available to your account. Ask your administrator if you need different access."}; }

export function helpForPath(pathname: string, pageHelp: PageHelp[]): PageHelp {
  if (/^\/operations\/accounts\/[^/]+\/statement$/.test(pathname)) return pageHelp.find(page => page.guideId === "statements") ?? genericPageHelp(pathname);
  return pageHelp.find((page) => page.route === pathname) ??
    pageHelp.filter((page) => page.route !== "/").sort((a, b) => b.route.length - a.route.length)
      .find((page) => pathname.startsWith(`${page.route}/`)) ??
    genericPageHelp(pathname);
}

export function stepMatchesPath(step: GuideStep, pathname: string) {
  return step.routePattern ? new RegExp(step.routePattern).test(pathname) : step.route === pathname;
}

export function filterGuides(query: string, category: string, workflowGuides: WorkflowGuide[]) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return workflowGuides.filter(guide => (category === "All" || (guide.category ?? "Customer journey") === category) && words.every(word =>
    [guide.title, guide.description, guide.category, ...guide.steps.map(step => `${step.title} ${step.body}`)].join(" ").toLowerCase().includes(word)));
}

export type GuideProgress = { step: number; reviewed: string[] };
export type GuidePreferences = { version: 1; enabled: boolean; activeGuide: string | null; progress: Record<string, GuideProgress> };
export const emptyGuidePreferences: GuidePreferences = { version: 1, enabled: false, activeGuide: null, progress: {} };

export function guideStorageKey(userId: string) { return `stor24:guided-help:v1:${encodeURIComponent(userId)}`; }

/** Browser state is untrusted; only known guide and step IDs can be restored. */
export function parseGuidePreferences(raw: string | null, workflowGuides: WorkflowGuide[]): GuidePreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1) return { ...emptyGuidePreferences, progress: {} };
    const progress: Record<string, GuideProgress> = {};
    for (const guide of workflowGuides) {
      const item = value.progress?.[guide.id];
      if (!item || typeof item !== "object") continue;
      progress[guide.id] = {
        step: typeof item.stepId === "string" ? Math.max(0, guide.steps.findIndex(step => step.id === item.stepId)) : (Number.isInteger(item.step) ? Math.max(0, Math.min(item.step, guide.steps.length - 1)) : 0),
        reviewed: guide.steps.filter(step => Array.isArray(item.reviewed) && item.reviewed.includes(step.id)).map(step => step.id),
      };
    }
    return { version: 1, enabled: value.enabled === true, activeGuide: workflowGuides.some(g => g.id === value.activeGuide) ? value.activeGuide : null, progress };
  } catch { return { ...emptyGuidePreferences, progress: {} }; }
}

export function reviewGuideStep(preferences: GuidePreferences, guideId: string, index: number, workflowGuides: WorkflowGuide[]): GuidePreferences {
  const guide = workflowGuides.find(item => item.id === guideId);
  const step = guide?.steps[index];
  if (!guide || !step) return preferences;
  const previous = preferences.progress[guideId]?.reviewed ?? [];
  return { ...preferences, activeGuide: guideId, progress: { ...preferences.progress,
    [guideId]: { step: Math.min(index + 1, guide.steps.length - 1), reviewed: Array.from(new Set([...previous, step.id])) },
  } };
}

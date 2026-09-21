"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Compass, LocateFixed, Pause, RotateCcw, X } from "lucide-react";
import { filterGuides, guideStorageKey, helpForPath, parseGuidePreferences, reviewGuideStep, stepMatchesPath, workflowGuides, type GuidePreferences, type GuideStep } from "@/lib/guided-help";

const preferenceEvent = "stor24-guided-help-change";
const unsavedPreferences = new Map<string, string>();
function readPreferences(key: string) {
  if (unsavedPreferences.has(key)) return unsavedPreferences.get(key)!;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(preferenceEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(preferenceEvent, callback); };
}
const serverSnapshot = () => null;

function useGuidePreferences(userId: string) {
  const key = guideStorageKey(userId);
  const snapshot = useCallback(() => readPreferences(key), [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const preferences = useMemo(() => parseGuidePreferences(raw), [raw]);
  const save = (next: GuidePreferences) => {
    const value = JSON.stringify(next);
    let saved = true;
    try { window.localStorage.setItem(key, value); unsavedPreferences.delete(key); }
    catch { unsavedPreferences.set(key, value); saved = false; }
    window.dispatchEvent(new Event(preferenceEvent));
    return saved;
  };
  return { preferences, save };
}

function findTarget(step: GuideStep) {
  const root = step.selector ? document.querySelector("main.content") : document;
  return Array.from(root?.querySelectorAll<HTMLElement>(step.selector ?? `[data-guide="${step.target}"]`) ?? [])
    .find(element => element.getClientRects().length > 0);
}

/** Highlight is visual only: it never clicks, focuses or changes a business form. */
function GuideHighlight({ step }: { step: GuideStep }) {
  const [rectangle, setRectangle] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = findTarget(step);
        const rect = target?.getBoundingClientRect();
        const next = rect && rect.bottom > 0 && rect.top < window.innerHeight
          ? { left: Math.max(3, rect.left - 4), top: Math.max(3, rect.top - 4), width: Math.max(0, Math.min(rect.right + 4, window.innerWidth - 3) - Math.max(3, rect.left - 4)), height: Math.max(0, Math.min(rect.bottom + 4, window.innerHeight - 3) - Math.max(3, rect.top - 4)) }
          : null;
        setRectangle(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = new MutationObserver(measure);
    const content = document.querySelector("main.content");
    if (content) observer.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    const resize = new ResizeObserver(measure);
    const target = findTarget(step);
    if (target) resize.observe(target);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step]);
  return rectangle ? <div className="guide-highlight" style={rectangle} aria-hidden="true" /> : null;
}

export function GuidedHelp({ userId }: { userId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { preferences, save } = useGuidePreferences(userId);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"library" | "guide" | "finished">("library");
  const [saveFailed, setSaveFailed] = useState(false);
  const [locateMessage, setLocateMessage] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const guide = workflowGuides.find(item => item.id === preferences.activeGuide);
  const progress = guide ? preferences.progress[guide.id] : undefined;
  const index = progress?.step ?? 0;
  const step = guide?.steps[index];
  const help = helpForPath(pathname);
  const screenView = view !== "library" && (!preferences.enabled || !guide) ? "library" : view;
  const active = open && screenView === "guide" && guide && step;
  const onStepPage = step && stepMatchesPath(step, pathname);
  const visibleGuides = filterGuides(query, category);
  const relatedGuides = workflowGuides.filter(item => item.id !== ("guideId" in help ? help.guideId : null) && item.steps.some(itemStep => stepMatchesPath(itemStep, pathname)));

  function persist(next: GuidePreferences) { setSaveFailed(!save(next)); }
  function close() { setOpen(false); setLocateMessage(""); trigger.current?.focus(); }
  function showLibrary() { setView("library"); setLocateMessage(""); setOpen(true); }
  function start(id: string, restart = false) {
    const selected = workflowGuides.find(item => item.id === id);
    if (!selected) return;
    persist({ ...preferences, enabled: true, activeGuide: id, progress: { ...preferences.progress,
      [id]: restart ? { step: 0, reviewed: [] } : (preferences.progress[id] ?? { step: 0, reviewed: [] }),
    } });
    setLocateMessage(""); setView("guide"); setOpen(true);
  }
  function goToStep(nextIndex: number) {
    if (!guide) return;
    persist({ ...preferences, progress: { ...preferences.progress,
      [guide.id]: { step: nextIndex, reviewed: progress?.reviewed ?? [] },
    } });
    setLocateMessage("");
  }
  function next() {
    if (!guide) return;
    const updated = reviewGuideStep(preferences, guide.id, index);
    persist(updated); setLocateMessage("");
    if (index === guide.steps.length - 1) setView("finished");
  }
  function locate() {
    if (!step) return;
    const target = findTarget(step);
    if (!target) { setLocateMessage(step.missing); return; }
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start", inline: "nearest" });
    setLocateMessage("The relevant area is outlined in orange. You can use the page normally, or pause the guide for more room.");
  }

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("guided-help-open");
    const escape = (event: KeyboardEvent) => {
      // A business modal owns Escape while it is open; never dismiss it from a guide.
      if (event.key !== "Escape" || document.querySelector(".modal-backdrop")) return;
      setOpen(false); trigger.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => { document.body.classList.remove("guided-help-open"); document.removeEventListener("keydown", escape); };
  }, [open]);

  useEffect(() => { if (open) heading.current?.focus(); }, [open, view, index, guide?.id]);

  return <>
    <button ref={trigger} type="button" className={`guide-trigger ${preferences.enabled ? "is-enabled" : ""}`} aria-expanded={open} aria-controls={open ? "guided-help-panel" : undefined} title="Tutorials and help with this page" onClick={() => open ? close() : showLibrary()}>
      <Compass size={18} aria-hidden="true" /><span>Guide me</span>{preferences.enabled && <span className="guide-enabled-dot" aria-label="Guide mode on" />}
    </button>
    {open && createPortal(<>
      {active && onStepPage && <GuideHighlight key={`${guide.id}:${step.id}`} step={step} />}
      <aside id="guided-help-panel" className="guide-panel" aria-label="STOR24 guided help">
        <div className="guide-panel-header"><span><Compass size={19} aria-hidden="true" /> YOUR WORKFLOW COMPANION</span><button type="button" className="guide-icon" aria-label="Close guided help" onClick={close}><X size={20} /></button></div>
        <div className="guide-panel-scroll">
          <div className="guide-intro"><p className="guide-eyebrow">STOR24 · LEARN AS YOU GO</p><h2 ref={heading} tabIndex={-1}>{screenView === "library" ? "A little guidance.\nA clearer next step." : screenView === "finished" ? "Reading complete." : guide?.title ?? "Your workflow guides"}</h2>
            {screenView === "library" && <p>Short guides to help you find your way and understand what happens next.</p>}
          </div>
          <div className="guide-mode"><div><strong>Guide mode</strong><small>{preferences.enabled ? "On · highlights available" : "Off · work without highlights"}</small></div><button type="button" role="switch" aria-checked={preferences.enabled} aria-label="Guide mode" className="guide-switch" onClick={() => { persist({ ...preferences, enabled: !preferences.enabled }); setView("library"); setLocateMessage(""); }}><span /></button></div>
          {saveFailed && <p role="status" className="guide-notice">Browser storage is unavailable. You can still use the guides, but your preference and progress may be lost when you leave.</p>}

          {screenView === "library" && <>
            <section className="guide-page-help"><span className="guide-eyebrow">HELP WITH THIS PAGE</span><h3>{help.title}</h3><p>{help.body}</p>{"guideId" in help && help.guideId && <button type="button" className="guide-text-action" onClick={() => start(help.guideId!)}>Guide me through this <ArrowRight size={16} /></button>}</section>
            {relatedGuides.length > 0 && <div className="guide-related"><strong>Also on this screen</strong>{relatedGuides.map(item => <button key={item.id} type="button" className="guide-text-action" onClick={() => start(item.id)}>{item.title}<ArrowRight size={14}/></button>)}</div>}
            {guide && progress && progress.reviewed.length < guide.steps.length && <button type="button" className="guide-resume" onClick={() => start(guide.id)}><span><strong>Continue where you left off</strong><small>{guide.title} · step {index + 1} of {guide.steps.length}</small></span><ArrowRight size={18} /></button>}
            <div className="guide-section-label"><BookOpen size={16} /><h3>Choose a workflow</h3></div>
            <div className="guide-library-filters"><label>Search guides<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try move-out, stock or refunds"/></label><label>Work area<select value={category} onChange={event => setCategory(event.target.value)}>{["All", ...new Set(workflowGuides.map(item => item.category ?? "Customer journey"))].map(item => <option key={item}>{item}</option>)}</select></label><p role="status">{visibleGuides.length} of {workflowGuides.length} guides</p>{(query || category !== "All") && <button className="guide-text-action" type="button" onClick={() => { setQuery(""); setCategory("All"); }}>Clear filters</button>}</div>
            <div className="guide-library">{visibleGuides.map((item) => {
              const number = workflowGuides.indexOf(item);
              const reviewed = preferences.progress[item.id]?.reviewed.length ?? 0;
              return <button type="button" key={item.id} className="guide-card" onClick={() => start(item.id)}><span className="guide-card-number">{reviewed === item.steps.length ? <Check size={18} /> : String(number + 1).padStart(2, "0")}</span><span><strong>{item.title}</strong><span className="guide-card-description">{item.description}</span><small>{item.category ?? "Customer journey"} · {item.duration} · {item.steps.length} steps{reviewed > 0 ? ` · ${reviewed} read` : ""}</small></span><ArrowRight size={17} /></button>;
            })}</div>
            {visibleGuides.length === 0 && <p className="guide-notice">No matching guides. Try a different term or clear the filters to see every workflow.</p>}
            <p className="guide-footnote">Starting a guide turns Guide mode on. Settings and reading progress are saved for your sign-in on this browser.</p>
          </>}

          {active && <>
            <div className="guide-progress-label"><span>STEP {index + 1} OF {guide.steps.length}</span><span>{progress?.reviewed.length ?? 0} read</span></div>
            <div className="guide-progress-track" role="progressbar" aria-label="Guide reading progress" aria-valuemin={0} aria-valuemax={guide.steps.length} aria-valuenow={progress?.reviewed.length ?? 0}><span style={{ width: `${((progress?.reviewed.length ?? 0) / guide.steps.length) * 100}%` }} /></div>
            <section className="guide-step" aria-live="polite" aria-atomic="true"><h3>{step.title}</h3><p>{step.body}</p>{step.caution && <div className="guide-caution"><strong>Before you act</strong><p>{step.caution}</p></div>}</section>
            {onStepPage ? <button type="button" className="guide-locate" onClick={locate}><LocateFixed size={17} /> Show me on this page</button> : <div className="guide-location"><p>This step refers to <strong>{step.screen}</strong>. You can keep reading here, or open that screen after saving any unfinished work.</p><button type="button" className="guide-locate" onClick={() => { setLocateMessage(""); if (step.route.endsWith(".html")) window.location.assign(step.route); else router.push(step.route); }}><ArrowRight size={17} /> Open {step.screen}</button>{guide.id === "move-in" && step.route === "/operations/move-in" && <small>Prefer the reservation row’s Move in link to keep its customer and unit selected.</small>}{step.routePattern && <small>Choose Account statement on the correct account to open this step. The guide never chooses a customer for you.</small>}</div>}
            {locateMessage && <p className="guide-notice" role="status">{locateMessage}</p>}
            <div className="guide-step-actions"><button type="button" className="guide-back" disabled={index === 0} onClick={() => goToStep(index - 1)}><ArrowLeft size={16} /> Back</button><button type="button" className="guide-primary" onClick={next}>{index === guide.steps.length - 1 ? "Finish reading" : "Read & next"}<ArrowRight size={16} /></button></div>
            <details className="guide-checklist"><summary>Guide checklist <span>{progress?.reviewed.length ?? 0}/{guide.steps.length} read</span></summary><ol>{guide.steps.map((item, position) => <li key={item.id}><button type="button" aria-current={position === index ? "step" : undefined} onClick={() => goToStep(position)}><span className={progress?.reviewed.includes(item.id) ? "is-read" : ""}>{progress?.reviewed.includes(item.id) ? <Check size={13} /> : position + 1}</span>{item.title}</button></li>)}</ol></details>
            <div className="guide-secondary-actions"><button type="button" onClick={() => start(guide.id, true)}><RotateCcw size={14} /> Restart</button><button type="button" onClick={showLibrary}><BookOpen size={14} /> All guides</button><button type="button" onClick={close}><Pause size={14} /> Pause</button></div>
          </>}

          {screenView === "finished" && guide && <section className="guide-finished"><CheckCircle2 size={38} aria-hidden="true" /><h3>{(progress?.reviewed.length ?? 0) === guide.steps.length ? "You’ve read every step." : "You’ve reached the last step."}</h3><p>{progress?.reviewed.length ?? 0} of {guide.steps.length} steps read in {guide.title}.</p><p>This records your learning progress only. It does not confirm that any customer task, payment or handover is complete.</p>{(progress?.reviewed.length ?? 0) < guide.steps.length && <button type="button" className="guide-locate" onClick={() => { goToStep(guide.steps.findIndex(item => !progress?.reviewed.includes(item.id))); setView("guide"); }}>Review unread steps</button>}<button type="button" className="guide-primary" onClick={showLibrary}>Explore another guide <ArrowRight size={16} /></button><button type="button" className="guide-text-action" onClick={() => start(guide.id, true)}>Restart this guide</button></section>}
        </div>
        <footer className="guide-panel-footer"><span className="guide-footer-dot" /> Guidance only. You stay in control of every action.</footer>
      </aside>
    </>, document.body)}
  </>;
}

import { extendedGuides } from "../lib/guided-help-catalog";

// Device-level reading state only. Never opens the encrypted operational database.
const guide = extendedGuides.find(item => item.id === "offline")!;
const key = "stor24:offline-guide:v1";
const toggle = document.querySelector<HTMLButtonElement>("#offline-guide-toggle")!;
const panel = document.querySelector<HTMLElement>("#offline-guide")!;
let state = { enabled: false, step: 0, reviewed: [] as number[] };
let storageFailed = false;
try {
  const saved = JSON.parse(localStorage.getItem(key) ?? "null");
  if (saved) state = { enabled: saved.enabled === true, step: Number.isInteger(saved.step) ? Math.max(0, Math.min(saved.step, guide.steps.length - 1)) : 0,
    reviewed: guide.steps.map((_, i) => i).filter(i => Array.isArray(saved.reviewed) && saved.reviewed.includes(i)) };
} catch { /* Corrupt or unavailable storage starts a fresh guide. */ }

function save() { try { localStorage.setItem(key, JSON.stringify(state)); } catch { storageFailed = true; } }
function clearHighlight() { document.querySelectorAll(".offline-guide-highlight").forEach(element => element.classList.remove("offline-guide-highlight")); }
function close() { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); clearHighlight(); toggle.focus(); }
function button(label: string, action: () => void) {
  const element = document.createElement("button"); element.type = "button"; element.textContent = label; element.addEventListener("click", action); return element;
}
function paragraph(value: string) { const element = document.createElement("p"); element.textContent = value; return element; }
function render(focus = true) {
  clearHighlight(); panel.replaceChildren();
  const closeButton = button("Close", close); closeButton.className = "offline-guide-close"; panel.append(closeButton);
  const heading = document.createElement("h2"); heading.textContent = "Offline workflow guide"; heading.tabIndex = -1; panel.append(heading);
  const mode = button(`Guide mode ${state.enabled ? "on" : "off"}`, () => { state.enabled = !state.enabled; save(); render(); });
  mode.setAttribute("role", "switch"); mode.setAttribute("aria-checked", String(state.enabled)); mode.setAttribute("aria-label", "Offline guide mode"); panel.append(mode);
  if (state.enabled) {
    const step = guide.steps[state.step];
    const title = document.createElement("h3"); title.textContent = step.title;
    panel.append(paragraph(`Step ${state.step + 1} of ${guide.steps.length} · ${state.reviewed.length} read`), title, paragraph(step.body));
    if (step.caution) panel.append(paragraph(`Before you act: ${step.caution}`));
    const message = paragraph(""); message.setAttribute("role", "status");
    panel.append(button("Show me on this page", () => {
      clearHighlight();
      const target = step.selector ? document.querySelector<HTMLElement>(step.selector) : null;
      if (!target || !target.getClientRects().length) { message.textContent = step.missing; return; }
      target.classList.add("offline-guide-highlight"); target.scrollIntoView({ block: "center" });
      message.textContent = "The relevant area is outlined in orange. Pause this guide if you need more room.";
    }), message);
    const back = button("Back", () => { state.step--; save(); render(); }); back.disabled = state.step === 0;
    panel.append(back, button(state.step === guide.steps.length - 1 ? "Finish reading" : "Read & next", () => {
      state.reviewed = [...new Set([...state.reviewed, state.step])];
      if (state.step < guide.steps.length - 1) state.step++;
      save(); render();
    }));
    if (state.reviewed.length === guide.steps.length) panel.append(paragraph("Every step read. This does not confirm any enquiry, reservation, payment or sync has completed."));
    panel.append(button("Restart", () => { state.step = 0; state.reviewed = []; save(); render(); }));
  } else {
    panel.append(paragraph("Turn on Guide mode for preparation, unlock, lead capture, unit requests, sync, conflicts and recovery. This never submits a business action."));
  }
  panel.append(button("Pause", close), paragraph("Reading position and switch preference are saved on this device, separately from your signed-in staff guides."));
  if (storageFailed) panel.append(paragraph("Browser storage is unavailable. Reading progress may be lost when you leave."));
  if (focus) heading.focus();
}
toggle.addEventListener("click", () => { if (!panel.hidden) close(); else { panel.hidden = false; toggle.setAttribute("aria-expanded", "true"); render(); } });
document.addEventListener("keydown", event => { if (event.key === "Escape" && !panel.hidden) close(); });

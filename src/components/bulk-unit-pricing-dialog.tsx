"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

type Unit = { id: string; number: string; monthlyRate: string; combinedIntoUnitId?: string | null; unitType: { areaSqMetres: string | null } };
const resultSchema = z.object({ data: z.object({
  facilityId: z.string(), action: z.enum(["preview", "apply"]), token: z.string().regex(/^[a-f0-9]{64}$/),
  changes: z.array(z.object({ unitId: z.string(), number: z.string(), currentRate: z.string().regex(/^\d+\.\d{2}$/), proposedRate: z.string().regex(/^\d+\.\d{2}$/) })).min(1),
}) });
type Preview = z.infer<typeof resultSchema>["data"];
const compare = new Intl.Collator("en-ZA", { numeric: true, sensitivity: "base" }).compare;
const money = (value: string) => Number(value).toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });

export function BulkUnitPricingDialog({ facility, close, applied, uncertain, denied }: {
  facility: { id: string; name: string; units: Unit[] }; close: () => void;
  applied: (count: number) => Promise<void>; uncertain: () => void; denied: (status: number) => void;
}) {
  const [area, setArea] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"SET" | "AMOUNT" | "PERCENT">("PERCENT");
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const pending = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; card.current?.focus(); return () => previous?.focus(); }, []);
  const units = facility.units.filter(u => !u.combinedIntoUnitId);
  const matches = units.filter(u => (!area || Number(u.unitType.areaSqMetres) === Number(area)) && (!from || compare(u.number, from.trim()) >= 0) && (!to || compare(u.number, to.trim()) <= 0)).sort((a, b) => compare(a.number, b.number));
  const reset = () => { setPreview(null); setSelected([]); setError(""); };
  async function submit(action: "preview" | "apply") {
    if (pending.current || blocked || !selected.length || !value.trim() || (action === "apply" && !preview)) return;
    pending.current = true; setBusy(true); setError("");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch("/api/v1/leasing/units/pricing", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ facilityId: facility.id, unitIds: selected, mode, value: Number(value), action, ...(action === "apply" ? { expectedToken: preview!.token } : {}) }) });
      if ([401, 403].includes(response.status)) { denied(response.status); return; }
      const payload = await response.json();
      if ([400, 409, 422].includes(response.status)) {
        setPreview(null); setError(z.object({ error: z.object({ message: z.string() }) }).safeParse(payload).success ? payload.error.message : "The adjustment was rejected. Review and preview again."); return;
      }
      const result = resultSchema.parse(payload).data;
      if (!response.ok || result.facilityId !== facility.id || result.action !== action || result.changes.length !== selected.length || new Set(result.changes.map(c => c.unitId)).size !== selected.length || result.changes.some(c => !selected.includes(c.unitId))) throw new Error("Mismatched pricing result");
      if (action === "apply") {
        if (JSON.stringify(result.changes) !== JSON.stringify(preview!.changes) || result.token !== preview!.token) throw new Error("Mismatched applied preview");
        await applied(result.changes.length);
      } else setPreview(result);
    } catch {
      setPreview(null);
      if (action === "apply") { setBlocked(true); uncertain(); }
      setError(action === "apply" ? "We could not confirm whether the adjustment completed. Close and review inventory before reloading. Do not repeat the adjustment." : "The preview could not be loaded. Try previewing again; no rates were changed.");
    } finally { clearTimeout(timer); pending.current = false; setBusy(false); }
  }
  return <div className="modal-backdrop"><div className="modal-card bulk-price-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-price-title" tabIndex={-1} ref={card} onKeyDown={event => {
    if (event.key === "Escape" && !busy) close();
    if (event.key === "Tab") {
      const controls = Array.from(card.current!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === card.current)) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <h2 id="bulk-price-title">Adjust unit prices · {facility.name}</h2>
    <p>Changes standard unit rates only. Existing tenancy rents, signed contracts and reservation quotes stay unchanged. Tax settings stay unchanged.</p>
    <fieldset disabled={busy || blocked}>
      <div className="form-grid">
        <label>Size (m²)<select aria-label="Size (m²)" value={area} onChange={e => { setArea(e.target.value); reset(); }}><option value="">All sizes</option>{[...new Set(units.flatMap(u => u.unitType.areaSqMetres ? [Number(u.unitType.areaSqMetres)] : []))].sort((a,b) => a-b).map(a => <option key={a} value={a}>{a} m²</option>)}</select></label>
        <label>From unit<input value={from} onChange={e => { setFrom(e.target.value); reset(); }} placeholder="e.g. G01" /></label>
        <label>To unit<input value={to} onChange={e => { setTo(e.target.value); reset(); }} placeholder="e.g. G20" /></label>
      </div>
      <p>Range includes both end units, using unit-number order. Review the matching units below.</p>
      <div className="form-actions"><button type="button" className="button button-secondary" disabled={!matches.length || matches.length > 1000} onClick={() => { setSelected(matches.map(u => u.id)); setPreview(null); }}>Select matching units ({matches.length})</button><button type="button" className="button button-secondary" onClick={reset}>Clear selection</button></div>
      <div className="table-scroll" style={{ maxHeight: "30vh", overflow: "auto" }}><table className="data-table"><thead><tr><th>Select</th><th>Unit</th><th>Size</th><th>Current rate</th></tr></thead><tbody>{matches.map(u => <tr key={u.id}><td><input type="checkbox" aria-label={`Select unit ${u.number}`} checked={selected.includes(u.id)} onChange={e => { setSelected(ids => e.target.checked ? [...ids, u.id] : ids.filter(id => id !== u.id)); setPreview(null); }} /></td><td>{u.number}</td><td>{u.unitType.areaSqMetres ?? "—"} m²</td><td>{money(u.monthlyRate)}</td></tr>)}</tbody></table></div>
      <div className="form-grid"><label>Adjustment<select value={mode} onChange={e => { setMode(e.target.value as typeof mode); setPreview(null); }}><option value="PERCENT">Increase / reduce by percentage</option><option value="AMOUNT">Increase / reduce by rand amount</option><option value="SET">Set monthly rate</option></select></label><label>{mode === "PERCENT" ? "Percentage" : "Rand amount"}<input type="number" step="0.01" value={value} onChange={e => { setValue(e.target.value); setPreview(null); }} /></label></div>
      <p>Use a negative value to reduce prices. {selected.length} selected; maximum 1,000 per adjustment.</p>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {preview && <section aria-label="Price adjustment preview"><h3>Review {preview.changes.length} selected units</h3><div className="table-scroll" style={{ maxHeight: "25vh", overflow: "auto" }}><table className="data-table"><thead><tr><th>Unit</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{preview.changes.map(c => <tr key={c.unitId}><td>{c.number}</td><td>{money(c.currentRate)}</td><td>{money(c.proposedRate)}</td></tr>)}</tbody></table></div></section>}
    <div className="form-actions"><button className="button button-secondary" disabled={busy} onClick={close}>Close</button><button className="button button-secondary" disabled={busy || blocked || !selected.length || selected.length > 1000 || !value.trim() || !Number.isFinite(Number(value))} onClick={() => void submit("preview")}>Preview prices</button>{preview && <button className="button button-primary" disabled={busy || blocked} onClick={() => void submit("apply")}>Confirm {preview.changes.length} price changes</button>}</div>
  </div></div>;
}

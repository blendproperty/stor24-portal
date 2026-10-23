"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { UnitRateAdjustment } from "@/lib/unit-rate-adjustment";

const money = (value: string) => Number(value).toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });
const rate = z.string().regex(/^\d+\.\d{2}$/).refine(value => Number(value) > 0);
const currentRate = z.string().regex(/^\d+\.\d{2}$/);
const previewRead = z.object({
  facilityId: z.string(), areaSqMetres: z.string(), direction: z.enum(["INCREASE", "REDUCE"]),
  mode: z.enum(["RAND", "PERCENT"]), value: z.string(), previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  updated: z.number().int().positive(), oldTotal: currentRate, newTotal: rate,
  changes: z.array(z.object({ unitId: z.string().min(1), number: z.string(), floor: z.string().nullable(),
    status: z.string(), type: z.string(), oldRate: currentRate, newRate: rate })).min(1),
  auditEventId: z.string().min(1).optional(),
});
export type UnitRatePreview = z.infer<typeof previewRead>;
type Facility = { id: string; name: string; unitTypes: { id: string; areaSqMetres: string | null }[] };

export function UnitRateAdjustmentDialog({ facility, initialArea, close, applied, denied, requestRef, blocked, uncertain, review }: {
  facility: Facility; initialArea: string; close: () => void; applied: (plan: UnitRatePreview) => Promise<void>;
  denied: (status: number) => void; requestRef: { current: AbortController | null }; blocked: boolean;
  uncertain: () => void; review: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [area, setArea] = useState(initialArea);
  const [direction, setDirection] = useState<UnitRateAdjustment["direction"]>("INCREASE");
  const [mode, setMode] = useState<UnitRateAdjustment["mode"]>("RAND");
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<UnitRatePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const sizes = [...new Set(facility.unitTypes.flatMap(type => Number(type.areaSqMetres) > 0 ? [String(Number(type.areaSqMetres))] : []))].sort((a, b) => Number(a) - Number(b));
  const disabled = busy || blocked || saved;
  const valid = Boolean(area && /^\d{1,8}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0);
  function changed() { setPreview(null); setError(""); }

  async function submit(action: "preview" | "apply") {
    if (disabled || requestRef.current || !valid || (action === "apply" && !preview)) return;
    const controller = new AbortController(); requestRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 25000);
    const input = { facilityId: facility.id, areaSqMetres: area, direction, mode, value };
    setBusy(true); setError("");
    if (action === "preview") setPreview(null);
    try {
      const response = await fetch("/api/v1/leasing/unit-rates/adjust", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, action, ...(action === "apply" ? { previewHash: preview!.previewHash } : {}) }), signal: controller.signal });
      if (response.status === 401 || response.status === 403) { setPreview(null); denied(response.status); return; }
      const payload = await response.json();
      if ([400, 404, 409, 422].includes(response.status)) {
        setPreview(null);
        const failure = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
        setError(failure.success ? failure.data.error.message : "The adjustment was rejected. Request a fresh preview."); return;
      }
      const result = previewRead.safeParse(payload.data);
      if (!response.ok || !result.success) throw Error("Unconfirmed adjustment");
      const plan = result.data;
      if (!Object.entries(input).every(([key, expected]) => plan[key as keyof typeof input] === expected)
        || new Set(plan.changes.map(row => row.unitId)).size !== plan.changes.length
        || plan.updated !== plan.changes.filter(row => row.oldRate !== row.newRate).length) throw Error("Mismatched adjustment");
      if (action === "apply") {
        if (!plan.auditEventId || plan.previewHash !== preview!.previewHash || JSON.stringify(plan.changes) !== JSON.stringify(preview!.changes)
          || plan.oldTotal !== preview!.oldTotal || plan.newTotal !== preview!.newTotal) throw Error("Mismatched confirmation");
        setSaved(true); setPreview(plan);
        await applied(plan);
      } else setPreview(plan);
    } catch {
      setPreview(null);
      if (action === "apply") { uncertain(); setError("We could not confirm whether these prices were saved. Review inventory before making another adjustment."); }
      else setError("The preview could not be loaded. No prices were changed. Try previewing again.");
    } finally {
      clearTimeout(timer); requestRef.current = null; setBusy(false);
    }
  }

  return <dialog ref={dialog} className="modal-card rate-adjustment-dialog" aria-labelledby="rate-adjustment-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <p className="eyebrow">{facility.name} · Standard unit rates</p>
    <h2 id="rate-adjustment-title">Adjust prices by size</h2>
    <p>Adjust every unit of the selected size at this store, across all floors and statuses. Combined component units are excluded.</p>
    <p>Existing tenancy rents and reservation quotes stay unchanged. Inventory table filters do not narrow this adjustment.</p>
    <form onSubmit={event => { event.preventDefault(); void submit("preview"); }}>
      <div className="inventory-form">
        <label>Unit size<select aria-label="Unit size" value={area} disabled={disabled} required onChange={event => { setArea(event.target.value); changed(); }}>
          <option value="">Select a size</option>{sizes.map(size => <option key={size} value={size}>{size} m²</option>)}
        </select></label>
        <label>Direction<select aria-label="Direction" value={direction} disabled={disabled} onChange={event => { setDirection(event.target.value as typeof direction); changed(); }}>
          <option value="INCREASE">Increase prices</option><option value="REDUCE">Reduce prices</option>
        </select></label>
        <label>Adjustment type<select aria-label="Adjustment type" value={mode} disabled={disabled} onChange={event => { setMode(event.target.value as typeof mode); changed(); }}>
          <option value="RAND">Rand per unit</option><option value="PERCENT">Percentage</option>
        </select></label>
        <label>{mode === "RAND" ? "Amount per unit (R)" : "Percentage (%)"}<input value={value} disabled={disabled} inputMode="decimal" required
          maxLength={11} pattern="[0-9]+(\.[0-9]{1,2})?" onChange={event => { setValue(event.target.value); changed(); }} /></label>
      </div>
      <p>Each current monthly rate is adjusted separately and rounded to the nearest cent. VAT rates stay unchanged.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      {preview && <section aria-label="Price adjustment preview">
        <h3>{saved ? "Prices saved" : "Review before confirming"}</h3>
        <p role="status">{preview.changes.length} units · {preview.updated} prices {saved ? "updated" : "will change"} · {area} m²</p>
        <p>Total standard monthly rates: <strong>{money(preview.oldTotal)} → {money(preview.newTotal)}</strong></p>
        <ul className="rate-adjustment-list">{preview.changes.map(row => <li key={row.unitId}>
          <div><strong>Unit {row.number}</strong><small>{row.type} · {row.floor ?? "No floor"} · {row.status.toLowerCase().replaceAll("_", " ")}</small></div>
          <div><small>Current</small><strong>{money(row.oldRate)}</strong></div>
          <div><small>New</small><strong>{money(row.newRate)}</strong></div>
        </li>)}</ul>
      </section>}
      <div className="form-actions">
        <button type="button" className="button button-secondary" disabled={busy} onClick={close}>{saved ? "Done" : "Cancel"}</button>
        {blocked && <button type="button" className="button button-secondary" disabled={busy} onClick={review}>Review inventory</button>}
        {!saved && <button className="button button-secondary" disabled={disabled || !valid}>{busy ? "Working…" : "Preview prices"}</button>}
        {!saved && preview && <button type="button" className="button button-primary" disabled={disabled} onClick={() => void submit("apply")}>Confirm {preview.updated} price changes</button>}
      </div>
    </form>
  </dialog>;
}

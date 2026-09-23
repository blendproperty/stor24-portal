"use client";

import { useState } from "react";
import { facilityFloorKeys, floorIsOperational, floorKey, floorLabel } from "@/lib/floor-availability";

type Facility = { id: string; name: string; closedFloors?: string[]; units: { floor: string | null; mapElements?: { map: { name: string } }[] }[]; maps?: { name: string }[] };

export function FloorAvailabilityControls({ facility, onSaved }: { facility: Facility; onSaved: (closedFloors: string[]) => void }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const floors = facilityFloorKeys(facility);
  if (!floors.length) return null;

  async function toggle(floor: string, operational: boolean) {
    setSaving(floor); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/floor-availability", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ facilityId: facility.id, floor, operational: !operational, expectedOperational: operational }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "The floor could not be updated.");
      onSaved(payload.data.closedFloors);
      setMessage(`${floorLabel(floor)} is now ${operational ? "under construction and unavailable for new bookings or move-ins" : "operational"}.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The floor could not be updated. Please try again."); }
    finally { setSaving(null); }
  }

  return <section className="panel floor-availability" aria-label="Floor availability" data-guide="floor-availability">
    <div><p className="eyebrow">{facility.name}</p><h2>Floor availability</h2><p>Open floors when they are ready for customers. Closed floors are excluded from bookings, move-ins and transfers. Existing unit and customer records are retained.</p></div>
    <div className="floor-availability-grid">{floors.map(floor => {
      const operational = floorIsOperational(floor, facility.closedFloors);
      const count = facility.units.filter(unit => floorKey(unit.floor) === floor || unit.mapElements?.some(element => floorKey(element.map.name) === floor)).length;
      return <div className="floor-availability-row" key={floor}>
        <div><strong>{floorLabel(floor)}</strong><span>{count} {count === 1 ? "unit" : "units"} · {operational ? "Operational" : "Under construction"}</span></div>
        <button type="button" role="switch" aria-checked={operational} aria-label={`${floorLabel(floor)} operational`} className="floor-availability-switch" disabled={saving !== null} onClick={() => void toggle(floor, operational)}><span aria-hidden="true" /></button>
      </div>;
    })}</div>
    {saving && <p role="status">Saving {floorLabel(saving)}…</p>}
    {message && <p className="form-success" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

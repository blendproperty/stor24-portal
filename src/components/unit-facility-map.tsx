"use client";
import { useEffect, useMemo, useState } from "react";
import { InventoryFloorViewport } from "./inventory-floor-viewport";
type Unit = {
  id: string;
  number: string;
  status: string;
  floorOperational?: boolean;
  monthlyRate: string;
  combinedIntoUnitId?: string | null;
  unitType: { areaSqMetres: string | null; useTypes?: string[] };
  useTypesOverride?: string[];
};
type Element = {
  id: string;
  unitId: string | null;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
  unit: Unit | null;
};
type Map = {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: Element[];
};
export function UnitFacilityMap({
  facilityId,
  visibleIds,
  onEdit,
  onRefresh,
}: {
  facilityId: string;
  visibleIds: string[];
  onEdit: (id: string) => void;
  onRefresh: () => void;
}) {
  const [maps, setMaps] = useState<Map[]>([]),
    [mapId, setMapId] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [combining, setCombining] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{
      area: number;
      monthlyRate: number;
      token: string;
    } | null>(null),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/v1/facility-map?facilityId=${encodeURIComponent(facilityId)}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw new Error(p.error?.message ?? "Map unavailable");
        const data =
          p.data.find((f: { id: string }) => f.id === facilityId)?.maps ?? [];
        setMaps(data);
        setMapId((data.find((m: Map) => /ground/i.test(m.name)) ?? data[0])?.id ?? "");
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [facilityId, refresh]);
  const map = maps.find((m) => m.id === mapId),
    units = selected
      .map((id) => map?.elements.find((e) => e.unitId === id)?.unit)
      .filter((u): u is Unit => Boolean(u));
  const matchingIds = useMemo(() => new Set(visibleIds), [visibleIds]);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const floor = useMemo(() => { const map = maps.find(m => m.id === mapId); return map ? ({ ...map, elements: map.elements.map(e => ({ ...e, unit: e.unit ? {
    id: e.unit.id, number: e.unit.number, status: e.unit.status, areaSqMetres: e.unit.unitType.areaSqMetres ? String(Number(e.unit.unitType.areaSqMetres)) : null,
    availability: (e.unit.floorOperational !== false && !e.unit.combinedIntoUnitId && ["AVAILABLE", "HELD", "RESERVED", "OCCUPIED"].includes(e.unit.status) ? "AVAILABLE" : "UNAVAILABLE") as "AVAILABLE" | "UNAVAILABLE",
  } : null })) }) : null; }, [maps, mapId]);
  const view = useMemo(() => {
    const map = maps.find(m => m.id === mapId);
    const elements = map?.elements.filter(e => e.unit || /lift|stair|elevator/i.test(`${e.type} ${e.label ?? ""}`)) ?? [];
    if (!elements.length) return { x: 0, y: 0, width: map?.width ?? 400, height: map?.height ?? 300 };
    const left = Math.min(...elements.map(e => e.x)), top = Math.min(...elements.map(e => e.y));
    const right = Math.max(...elements.map(e => e.x+e.width)), bottom = Math.max(...elements.map(e => e.y+e.height));
    const padding = Math.max(right-left, bottom-top) * .035;
    return { x: left-padding, y: top-padding, width: right-left+padding*2, height: bottom-top+padding*2 };
  }, [maps, mapId]);
  const matchingCount = map?.elements.filter(e => e.unit && matchingIds.has(e.unit.id)).length ?? 0;
  function choose(id: string) {
    setPreview(null); setReady(false);
    setSelected(s => combining ? s.includes(id) ? s.filter(value => value !== id) : [...s.slice(-1), id] : [id]);
  }
  function toggleCombining() { setCombining(v => !v); setSelected([]); setPreview(null); setReady(false); }
  async function action(kind: "preview" | "apply") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/v1/leasing/units/combine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          facilityId,
          unitIds: selected,
          action: kind,
          physicalConnectionConfirmed: ready,
          expectedToken: preview?.token,
        }),
      });
      const p = await r.json();
      if (!r.ok)
        throw new Error(
          p.error?.message ?? "Unable to update this combination.",
        );
      if (kind === "preview") setPreview(p.data);
      else {
        setPreview(null);
        setSelected([]);
        setReady(false);
        setRefresh((v) => v + 1);
        onRefresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Combination failed");
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel panel-spacious inventory-facility-map">
    <div className="inventory-map-header">
      <div><p className="inventory-map-eyebrow">Explore your facility</p><h2>Units at a glance</h2>
        <p className="panel-subtitle">Choose a unit on the map to see its space, price and availability.</p></div>
      <a className="inventory-layout-link" href="/map">Edit layout →</a>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {maps.length && map && floor ? <>
      <div className="inventory-map-toolbar">
        <label>Floor<select value={mapId} onChange={e => {setMapId(e.target.value);setSelected([]);setPreview(null);setReady(false);}}>
          {maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>
        <span className="inventory-map-matches">{matchingCount} units match your filters</span>
        <button type="button" className="button button-secondary inventory-combine-toggle" aria-expanded={combining} onClick={toggleCombining}>
          {combining ? "Cancel combination" : "Combine adjacent units"}
        </button>
      </div>
      <div className="inventory-map-layout">
        <div className="inventory-map-main">
          <div className="inventory-map-legend" aria-label="Unit availability legend">
            <span><i className="is-available"/>Available</span><span><i className="is-held"/>Held / reserved</span>
            <span><i className="is-occupied"/>Occupied</span><span><i className="is-unavailable"/>Unavailable / closed</span>
          </div>
          <InventoryFloorViewport key={map.id} floor={floor} view={view} matchingIds={matchingIds} selectedIds={selectedIds} onSelect={choose}/>
        </div>
        <aside className="inventory-map-details" aria-label="Selected unit details" aria-live="polite">
          {!units.length ? <div className="inventory-map-empty"><div className="inventory-unit-outline" aria-hidden="true">↖</div>
            <h3>{combining ? "Select two neighbouring units" : "Find the right space"}</h3>
            <p>{combining ? "Choose two available units that share a suitable boundary, then preview their combined space." : "Select any unit to see its details. The map highlights units matching your filters."}</p>
            <small>{combining ? "A physical connection must be approved and completed before combining." : "Orange highlights your selection."}</small>
          </div> : units.map(u => <div className="inventory-unit-summary" key={u.id}>
            <span className={`inventory-unit-status ${u.floorOperational === false ? "is-unavailable" : `is-${u.status.toLowerCase()}`}`}>{u.floorOperational === false ? "Closed floor" : u.status === "AVAILABLE" ? "Available" : u.status.charAt(0)+u.status.slice(1).toLowerCase()}</span>
            <h3>Unit {u.number}</h3><p className="inventory-unit-area">{u.unitType.areaSqMetres ? Number(u.unitType.areaSqMetres).toLocaleString("en-ZA") : "—"} m² <span>· {map.name}</span></p>
            <div className="inventory-unit-products">{(u.useTypesOverride?.length ? u.useTypesOverride : u.unitType.useTypes ?? ["STORAGE"]).map(p => <span key={p}>{p === "MICRO_WAREHOUSE" ? "Micro Warehousing" : "Self-Storage"}</span>)}</div>
            <div className="inventory-unit-price"><strong>R {Number(u.monthlyRate).toLocaleString("en-ZA")}</strong><span>per month</span></div>
            <button className="button button-primary" onClick={() => onEdit(u.id)}>Edit unit</button>
          </div>)}
          {combining ? <div className="combination-controls">
            <button className="button button-secondary" disabled={selected.length !== 2 || busy} onClick={() => void action("preview")}>{busy ? "Preparing…" : "Preview combination"}</button>
            {preview ? <><div className="inventory-combined-price"><strong>{preview.area} m²</strong><span>R {preview.monthlyRate.toLocaleString("en-ZA")} / month</span><small>Combined at the current unit rates.</small></div>
              <label><input type="checkbox" checked={ready} onChange={e => setReady(e.target.checked)}/> The units share a suitable boundary and the approved physical connection is complete and safe for occupation.</label>
              <button className="button button-primary" disabled={!ready || busy} onClick={() => void action("apply")}>Combine units</button></> : null}
          </div> : null}
        </aside>
      </div>
    </> : <p>{loading ? "Loading your facility map…" : error ? "The map could not be loaded." : "No saved map is available for this facility."}</p>}
  </section>;
}

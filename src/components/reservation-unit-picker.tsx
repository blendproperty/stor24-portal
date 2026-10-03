"use client";
import { useState } from "react";
export type ReservationUnit = {id: string; number: string; monthlyRate: string; facilityId: string};
export type ReservationMap = {id: string; name: string; width: number; height: number; elements: {id: string; type: string; x: number; y: number; width: number; height: number; rotation: number; label: string | null; unitId: string | null}[]};
export function ReservationUnitPicker({units,maps,initialUnitId=""}: {units: ReservationUnit[]; maps: ReservationMap[]; initialUnitId?: string}) {
  const [zoom,setZoom] = useState(1); const [unitId,setUnitId] = useState(initialUnitId); const [mapId,setMapId] = useState(maps[0]?.id || ""); const [rate,setRate] = useState(units.find(u=>u.id===initialUnitId)?.monthlyRate || ""); const map = maps.find(m=>m.id===mapId);
  function choose(id: string) {const unit=units.find(u=>u.id===id);setUnitId(id);setRate(unit?.monthlyRate || "");}
  return <div className="reservation-unit-picker"><div className="leads-section-title"><h3>Select storage space</h3><span className="leads-caption">{units.length} available units</span></div>
    {maps.length ? <><label>Floor / layout<select aria-label="Floor / layout" value={mapId} onChange={e=>setMapId(e.target.value)}>{maps.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p className="leads-caption">Select a green unit. Grey units are unavailable. Orange is your selection.</p>
      <label>Map zoom<input aria-label="Map zoom" type="range" min="1" max="3" step="0.25" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>{map&&<div className="reservation-map-scroll"><svg viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label={`${map.name} unit selection`} className="reservation-map" style={{width: `${zoom*100}%`, maxHeight: "none"}}>{map.elements.map(e=>{
        const unit=units.find(u=>u.id===e.unitId);const available=!!unit;const selected=e.unitId===unitId && !!unitId;const isUnit=e.type==="UNIT";
        return <g key={e.id} transform={`rotate(${e.rotation} ${e.x+e.width/2} ${e.y+e.height/2})`} role={available?"button":undefined} tabIndex={available?0:undefined} aria-label={available?`Select unit ${unit.number}, R ${unit.monthlyRate} per month`:undefined} aria-pressed={available?selected:undefined} onClick={()=>{if(unit)choose(unit.id);}} onKeyDown={event=>{if(unit&&["Enter"," "].includes(event.key)){event.preventDefault();choose(unit.id);}}} style={{cursor:available?"pointer":"default"}}>
          <title>{unit?`Unit ${unit.number} · R ${unit.monthlyRate} / month`:isUnit?"Unavailable unit":e.label || e.type.replaceAll("_"," ")}</title>
          <rect x={e.x} y={e.y} width={e.width} height={e.height} rx={isUnit?2:0} fill={selected?"#ff5a0a":available?"#d5eadc":isUnit?"#e5e7e5":"#f0ece2"} stroke={selected?"#a43c05":available?"#417757":"#b4bab3"}/>
          {(isUnit||e.type==="LABEL")&&<text x={e.x+e.width/2} y={e.y+e.height/2} dominantBaseline="middle" textAnchor="middle" fontSize={Math.max(8,Math.min(18,e.height*.35))} fill="#18392a">{unit?.number || e.label || ""}</text>}
        </g>;
      })}</svg></div>}</> : <p className="leads-caption">No floor layout configured. Select an available unit below.</p>}
    <label>Available unit<select aria-label="Available unit" name="unitId" required value={unitId} onChange={e=>choose(e.target.value)}><option value="">Choose an available unit</option>{units.map(u=><option key={u.id} value={u.id}>Unit {u.number} · R {Number(u.monthlyRate).toLocaleString("en-ZA")}</option>)}</select></label>
    <label>Monthly quote (R)<input aria-label="Monthly quote (R)" name="quotedRate" type="number" min="0" step="0.01" required value={rate} onChange={e=>setRate(e.target.value)}/></label>
  </div>;
}

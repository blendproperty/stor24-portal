"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import InventoryFloorCanvas, { type PlanElement, type PlanView } from "./inventory-floor-canvas";

export function InventoryFloorViewport({ floor, view, selectedIds, matchingIds, onSelect }: {
  floor: { id: string; name: string; elements: PlanElement[] };
  view: PlanView;
  selectedIds: Set<string>;
  matchingIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, y: 0, left: 0, top: 0, distance: 0, zoom: 1, moved: false });
  const baseWidth = size.width < 600 ? Math.max(size.width, 850) : Math.min(size.width, size.height * view.width / view.height);
  const width = baseWidth * zoom;
  const height = width * view.height / view.width;
  const held = new Set(floor.elements.filter(e => e.unit && ["HELD", "RESERVED"].includes(e.unit.status ?? "") && e.unit.availability === "AVAILABLE").map(e => e.unit!.id));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function changeZoom(value: number, origin?: { x: number; y: number }) {
    const el = host.current;
    if (!el) return;
    const next = Math.max(1, Math.min(3, value));
    const ratio = next / zoomRef.current;
    const x = origin?.x ?? el.clientWidth / 2, y = origin?.y ?? el.clientHeight / 2;
    const left = (el.scrollLeft + x) * ratio - x, top = (el.scrollTop + y) * ratio - y;
    zoomRef.current = next; setZoom(next);
    requestAnimationFrame(() => { el.scrollLeft = next === 1 ? 0 : left; el.scrollTop = next === 1 ? 0 : top; });
  }

  function startGesture() {
    const el = host.current, values = [...pointers.current.values()];
    if (!el || !values.length) return;
    gesture.current = { x: values[0].x, y: values[0].y, left: el.scrollLeft, top: el.scrollTop,
      distance: values.length > 1 ? Math.hypot(values[1].x-values[0].x, values[1].y-values[0].y) : 0,
      zoom: zoomRef.current, moved: gesture.current.moved };
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!pointers.current.size) gesture.current.moved = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); startGesture();
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const el = host.current;
    if (!el || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const values = [...pointers.current.values()], start = gesture.current;
    const dx = values[0].x-start.x, dy = values[0].y-start.y;
    if (values.length > 1 && start.distance) {
      start.moved = true;
      const bounds = el.getBoundingClientRect();
      changeZoom(start.zoom * Math.hypot(values[1].x-values[0].x, values[1].y-values[0].y) / start.distance,
        { x: (values[0].x+values[1].x)/2-bounds.left, y: (values[0].y+values[1].y)/2-bounds.top });
    } else if (Math.hypot(dx, dy) > 5 || start.moved) {
      start.moved = true; el.setPointerCapture(e.pointerId);
      el.scrollLeft = start.left-dx; el.scrollTop = start.top-dy;
    }
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (host.current?.hasPointerCapture(e.pointerId)) host.current.releasePointerCapture(e.pointerId);
    if (pointers.current.size) startGesture();
  }

  return <div className="inventory-plan-explorer">
    <div className="inventory-plan-heading"><strong>{floor.name}</strong><span>Live availability</span>
      <div className="inventory-plan-controls" role="group" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => changeZoom(zoomRef.current * 1.3)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => changeZoom(zoomRef.current / 1.3)}>−</button>
        <button type="button" onClick={() => changeZoom(1)}>Fit map</button>
      </div>
    </div>
    <div ref={host} className="inventory-plan-viewport" role="region" aria-label={`${floor.name} unit map`} tabIndex={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onClickCapture={e => { if (e.detail > 0 && gesture.current.moved) { e.preventDefault(); e.stopPropagation(); } }}>
      <div className="inventory-plan-surface" role="group" aria-label={`${floor.name} unit availability map`} style={{ width, height }}>
        <InventoryFloorCanvas floor={floor} view={view} recommendedIds={held} selectedIds={selectedIds} matchingIds={matchingIds}/>
        {floor.elements.filter(e => e.unit).map(e => <button key={e.id} type="button"
          className="inventory-plan-unit" aria-pressed={selectedIds.has(e.unit!.id)}
          aria-label={`Unit ${e.unit!.number}, ${e.unit!.availability === "UNAVAILABLE" ? "Closed floor / unavailable" : e.unit!.status}, ${e.unit!.areaSqMetres ?? "unknown"} square metres`}
          title={`Unit ${e.unit!.number} · ${e.unit!.status}`}
          style={{ left: `${(e.x-view.x)/view.width*100}%`, top: `${(e.y-view.y)/view.height*100}%`, width: `${e.width/view.width*100}%`, height: `${e.height/view.height*100}%`, transform: `rotate(${e.rotation || 0}deg)` }}
          onFocus={event => { gesture.current.moved = false; const el=host.current; if (!el) return;
            const box=event.currentTarget.getBoundingClientRect(), bounds=el.getBoundingClientRect();
            if (box.left<bounds.left) el.scrollLeft-=bounds.left-box.left; else if (box.right>bounds.right) el.scrollLeft+=box.right-bounds.right;
            if (box.top<bounds.top) el.scrollTop-=bounds.top-box.top; else if (box.bottom>bounds.bottom) el.scrollTop+=box.bottom-bounds.bottom;
          }} onClick={() => onSelect(e.unit!.id)}><span>{e.unit!.number}</span></button>)}
      </div>
    </div>
    <p className="inventory-plan-help">Drag to explore · Pinch or use + / − to zoom</p>
  </div>;
}

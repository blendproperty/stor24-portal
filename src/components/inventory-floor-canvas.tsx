"use client";

import { useEffect, useRef } from "react";
import { exposedFacadeSegments } from "./inventory-facade-segments";

export type PlanUnit = {
  id: string;
  number: string;
  availability: "AVAILABLE" | "UNAVAILABLE";
  status?: string;
  areaSqMetres?: string | null;
};

export type PlanElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label?: string | null;
  unit?: PlanUnit | null;
};

export type PlanFloor = { elements: PlanElement[] };
export type PlanView = { x: number; y: number; width: number; height: number };

function fixtureKind(element: PlanElement) {
  const value = `${element.type} ${element.label || ""}`.toLowerCase();
  if (value.includes("lift") || value.includes("elevator")) return "lift";
  if (value.includes("stair")) return "stairs";
  return null;
}

const WALL_HEIGHT_METRES = 2.3;

function hasExposedRightSide(unit: PlanElement, units: PlanElement[]) {
  const edge = unit.x + unit.width;
  const touchingUnitOnRight = units.some((candidate) => {
    if (candidate.id === unit.id) return false;
    const verticalOverlap = Math.min(unit.y + unit.height, candidate.y + candidate.height) - Math.max(unit.y, candidate.y);
    if (verticalOverlap <= 2) return false;
    const horizontalGap = candidate.x - edge;
    return horizontalGap >= -2 && horizontalGap <= 18;
  });
  return !touchingUnitOnRight;
}

/**
 * Renders a facility floor plan onto a canvas with a lightweight "3D" facade
 * treatment. NOTE: the junction-panel wall recesses below key off specific
 * Midpoint unit numbers (12/13/14, 171/173/174, 366/368/369, 331/332/333,
 * 525/526/527) discovered empirically for that building's geometry. For any
 * other facility those lookups simply find nothing and are skipped — the
 * plan still renders correctly, it just won't have those decorative recessed
 * wall panels. Making this fully data-driven from map geometry is tracked as
 * follow-up work, not a blocker for reusing this renderer across facilities.
 */
export default function InventoryFloorCanvas({ floor, view, recommendedIds, selectedIds, matchingIds }: {
  floor: PlanFloor;
  view: PlanView;
  recommendedIds: Set<string>;
  selectedIds: Set<string>;
  matchingIds: Set<string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;

    const draw = () => {
      const rect = host.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const sx = rect.width / view.width;
      const sy = rect.height / view.height;
      const px = (x: number) => (x - view.x) * sx;
      const py = (y: number) => (y - view.y) * sy;
      const depth = Math.max(3, Math.min(6, rect.width / 180)) * (WALL_HEIGHT_METRES / 2.3);

      const fixtures = floor.elements.filter((item) => fixtureKind(item));
      const units = floor.elements.filter((item) => item.unit);
      const isUpperFloor = units.some((item) => Number(item.unit!.number) > 140);
      const lifts = fixtures.filter((item) => fixtureKind(item) === "lift");
      const coreCentreX = lifts.length
        ? lifts.reduce((sum, item) => sum + item.x + item.width / 2, 0) / lifts.length
        : null;
      const stairs = fixtures.find((item) => fixtureKind(item) === "stairs");
      const coreTop = stairs ? py(stairs.y) : null;
      const orderedCore = [
        ...(stairs ? [stairs] : []),
        ...lifts.sort((a, b) => a.y - b.y),
      ];
      const coreY = new Map<string, number>();
      if (coreTop !== null) {
        let nextY = coreTop;
        orderedCore.forEach((item) => {
          coreY.set(item.id, nextY);
          const itemHeight = fixtureKind(item) === "stairs"
            ? Math.max(item.height * sy, (isUpperFloor ? 150 : 170) * sy)
            : Math.max(item.height * sy, 160 * sy);
          nextY += itemHeight;
        });
      }

      ctx.lineCap = "square";
      units.forEach((element) => {
        const unit = element.unit!;
        const x = px(element.x);
        const y = py(element.y);
        const w = Math.max(2, element.width * sx);
        const h = Math.max(2, element.height * sy);
        const selected = selectedIds.has(unit.id);
        const recommended = recommendedIds.has(unit.id);
        const occupied = unit.status === "OCCUPIED" && unit.availability !== "UNAVAILABLE";
        const unavailable = unit.availability !== "AVAILABLE";
        const d = depth;
        const facadeSegments = exposedFacadeSegments(element, units)
          .map(({ start, end }) => ({ start: start * sx, end: end * sx }));
        const showRightWall = hasExposedRightSide(element, units);

        ctx.save();
        ctx.globalAlpha = matchingIds.has(unit.id) ? 1 : .34;
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((element.rotation || 0) * Math.PI / 180);
        ctx.translate(-w / 2, -h / 2);

        ctx.shadowColor = selected ? "rgba(255,90,10,.12)" : "rgba(16,31,26,.06)";
        ctx.shadowBlur = selected ? 4 : 2;
        ctx.shadowOffsetX = d * .45;
        ctx.shadowOffsetY = d * .75;
        const drawRightWall = () => {
          const edgeX = w;
          const sideWall = new Path2D();
          sideWall.moveTo(edgeX, 0);
          sideWall.lineTo(edgeX, h);
          sideWall.lineTo(edgeX + d * .42, h + d);
          sideWall.lineTo(edgeX + d * .42, d);
          sideWall.closePath();
          const sideGradient = ctx.createLinearGradient(edgeX, 0, edgeX + d * .42, 0);
          if (unavailable) { sideGradient.addColorStop(0, "#d0d3ce"); sideGradient.addColorStop(1, "#afb7b0"); }
          else { sideGradient.addColorStop(0, "#aeb4af"); sideGradient.addColorStop(1, "#53635d"); }
          ctx.fillStyle = sideGradient;
          ctx.strokeStyle = unavailable ? "#89968e" : "#29463d";
          ctx.lineWidth = 1;
          ctx.fill(sideWall);
          ctx.stroke(sideWall);
        };
        if (showRightWall) drawRightWall();

        const facadeGradient = ctx.createLinearGradient(0, h, 0, h + d);
        if (selected) { facadeGradient.addColorStop(0, "#f24b08"); facadeGradient.addColorStop(1, "#7e2106"); }
        else if (recommended) { facadeGradient.addColorStop(0, "#f58a4c"); facadeGradient.addColorStop(1, "#9b380d"); }
        else if (unavailable) { facadeGradient.addColorStop(0, "#d0d3ce"); facadeGradient.addColorStop(.5, "#c4c9c3"); facadeGradient.addColorStop(1, "#afb7b0"); }
        else { facadeGradient.addColorStop(0, "#c8cbc6"); facadeGradient.addColorStop(.45, "#8f9691"); facadeGradient.addColorStop(1, "#4d5c57"); }
        ctx.fillStyle = facadeGradient;
        ctx.strokeStyle = selected ? "#561704" : unavailable ? "#89968e" : "#29463d";
        ctx.lineWidth = 1;
        for (const { start, end } of facadeSegments) {
          const facade = new Path2D();
          facade.moveTo(start, h);
          facade.lineTo(end, h);
          facade.lineTo(end + d * .42, h + d);
          facade.lineTo(start + d * .42, h + d);
          facade.closePath();
          ctx.fill(facade);
          ctx.stroke(facade);
        }

        ctx.shadowColor = "transparent";
        const top = ctx.createLinearGradient(0, 0, w, h);
        if (selected) { top.addColorStop(0, "#ff681f"); top.addColorStop(1, "#ff510a"); }
        else if (recommended) { top.addColorStop(0, "#ffd2b4"); top.addColorStop(1, "#ffbc96"); }
        else if (occupied) { top.addColorStop(0, "#d9eaf2"); top.addColorStop(1, "#aacddd"); }
        else if (unavailable) { top.addColorStop(0, "#eceee9"); top.addColorStop(1, "#d9ded7"); }
        else { top.addColorStop(0, "#ffffff"); top.addColorStop(.55, "#fafbf8"); top.addColorStop(1, "#f2f4ef"); }
        ctx.fillStyle = top;
        ctx.strokeStyle = selected ? "#ff510a" : recommended ? "#e2966c" : unavailable ? "#89968e" : "#173f35";
        ctx.lineWidth = selected ? 2.2 : 1.25;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeRect(.5, .5, Math.max(0, w - 1), Math.max(0, h - 1));

        if (selected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.strokeRect(2, 2, Math.max(0, w - 4), Math.max(0, h - 4));
        }

        if (unavailable && w > 9 && h > 9) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(.5, .5, Math.max(0, w - 1), Math.max(0, h - 1));
          ctx.clip();
          ctx.strokeStyle = "rgba(112,126,116,.22)";
          ctx.lineWidth = 1;
          const gap = 6;
          for (let offset = -h; offset < w; offset += gap) {
            ctx.beginPath();
            ctx.moveTo(offset, 0);
            ctx.lineTo(offset + h, h);
            ctx.stroke();
          }
          ctx.restore();
        }

        ctx.strokeStyle = selected ? "rgba(80,18,0,.72)" : unavailable ? "rgba(74,46,34,.55)" : "rgba(41,56,51,.52)";
        ctx.lineWidth = .7;
        for (const { start, end } of facadeSegments) {
          const stripeCount = Math.max(2, Math.min(6, Math.floor(d / 2.5)));
          for (let stripe = 1; stripe < stripeCount; stripe++) {
            const t = stripe / stripeCount;
            ctx.beginPath();
            ctx.moveTo(start + d * .42 * t, h + d * t);
            ctx.lineTo(end + d * .42 * t, h + d * t);
            ctx.stroke();
          }
        }

        if (facadeSegments.length === 1 && facadeSegments[0].start === 0 && facadeSegments[0].end === w && Math.max(w, h) > 26) {
          ctx.fillStyle = selected ? "#ffb28c" : "rgba(242,244,240,.8)";
          ctx.fillRect(w * .44, h + d * .2, Math.max(2, w * .12), Math.max(1, d * .16));
        }

        const fontSize = Math.max(6, Math.min(16, Math.min(w * .3, h * .36)));
        if (w >= 8 && h >= 7) {
          ctx.fillStyle = selected ? "#fff" : unavailable ? "#657269" : "#071411";
          ctx.font = `800 ${fontSize}px Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(unit.number, w / 2, h / 2, Math.max(6, w - 3));
        }
        ctx.restore();
      });

      const unitByNumber = new Map(units.map((element) => [element.unit!.number, element]));
      const junctionPanels: Array<{ x: number; y: number; width: number; height: number; lowerReturn?: boolean }> = [];
      const unit12 = unitByNumber.get("12"), unit13 = unitByNumber.get("13"), unit14 = unitByNumber.get("14");
      if (unit12 && unit13 && unit14) {
        junctionPanels.push({
          x: unit12.x + unit12.width,
          y: unit13.y + unit13.height,
          width: unit14.x - (unit12.x + unit12.width),
          height: unit12.y + unit12.height - (unit13.y + unit13.height),
        });
      }
      const unit171 = unitByNumber.get("171"), unit173 = unitByNumber.get("173"), unit174 = unitByNumber.get("174");
      if (unit171 && unit173 && unit174) {
        junctionPanels.push({
          x: unit171.x + unit171.width,
          y: unit173.y + unit173.height,
          width: unit174.x - (unit171.x + unit171.width),
          height: unit171.y + unit171.height - (unit173.y + unit173.height),
        });
      }
      const unit366 = unitByNumber.get("366"), unit368 = unitByNumber.get("368"), unit369 = unitByNumber.get("369");
      if (unit366 && unit368 && unit369) {
        junctionPanels.push({
          x: unit366.x + unit366.width,
          y: unit368.y + unit368.height,
          width: unit369.x - (unit366.x + unit366.width),
          height: unit366.y + unit366.height - (unit368.y + unit368.height),
        });
      }
      const unit331 = unitByNumber.get("331"), unit332 = unitByNumber.get("332"), unit333 = unitByNumber.get("333");
      if (unit331 && unit332 && unit333) {
        junctionPanels.push({
          x: unit332.x + unit332.width,
          y: unit331.y + unit331.height,
          width: unit331.x + unit331.width - (unit332.x + unit332.width),
          height: unit333.y - (unit331.y + unit331.height),
          lowerReturn: true,
        });
      }
      const unit525 = unitByNumber.get("525"), unit526 = unitByNumber.get("526"), unit527 = unitByNumber.get("527");
      if (unit525 && unit526 && unit527) {
        junctionPanels.push({
          x: unit526.x + unit526.width,
          y: unit525.y + unit525.height,
          width: unit525.x + unit525.width - (unit526.x + unit526.width),
          height: unit527.y - (unit525.y + unit525.height),
          lowerReturn: true,
        });
      }
      junctionPanels.filter((panel) => panel.width > 0 && panel.height > 0).forEach((panel) => {
        const x = px(panel.x), y = py(panel.y);
        const w = panel.width * sx, h = panel.height * sy;
        const wallDepth = Math.min(w * .42, depth * 1.15);
        const wallGradient = ctx.createLinearGradient(x, y, x + wallDepth, y);
        wallGradient.addColorStop(0, "#aeb4af");
        wallGradient.addColorStop(1, "#53635d");
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, w, h);
        const recessedWall = new Path2D();
        recessedWall.moveTo(x, y);
        recessedWall.lineTo(x + wallDepth, y + depth);
        recessedWall.lineTo(x + wallDepth, y + h + (panel.lowerReturn ? 0 : depth));
        recessedWall.lineTo(x, y + h);
        recessedWall.closePath();
        ctx.fillStyle = wallGradient;
        ctx.shadowColor = "rgba(16,31,26,.06)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = depth * .2;
        ctx.shadowOffsetY = depth * .35;
        ctx.fill(recessedWall);
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "#173f35";
        ctx.lineWidth = 2;
        ctx.lineJoin = "miter";
        ctx.stroke(recessedWall);
        ctx.beginPath();
        ctx.moveTo(x + wallDepth, y + depth);
        ctx.lineTo(x + w + (panel.lowerReturn ? depth * .42 : 0), y + depth);
        ctx.stroke();
        if (panel.lowerReturn) {
          ctx.beginPath();
          ctx.moveTo(x + wallDepth, y + h);
          ctx.lineTo(x + w, y + h);
          ctx.stroke();
        }
        ctx.restore();
      });

      fixtures.forEach((element) => {
        const kind = fixtureKind(element)!;
        let w = Math.max(7, element.width * sx), h = Math.max(7, element.height * sy);
        const originalW = w, originalH = h;
        if (kind === "stairs") {
          w = Math.max(w, (isUpperFloor ? 185 : 210) * sx);
          h = Math.max(h, (isUpperFloor ? 150 : 170) * sy);
        } else {
          w = Math.max(w, 210 * sx);
          h = Math.max(h, 160 * sy);
        }
        const x = coreCentreX === null
          ? px(element.x) - (w - originalW) / 2
          : px(coreCentreX) - w / 2;
        const y = coreY.get(element.id) ?? (py(element.y) - (h - originalH) / 2);
        ctx.save();
        ctx.fillStyle = kind === "stairs" ? "#293832" : "#e3e4df";
        ctx.strokeStyle = "#344d45";
        ctx.lineWidth = 1.4;
        ctx.shadowColor = "rgba(7,20,17,.2)";
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 4;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.shadowColor = "transparent";
        if (kind === "stairs") {
          const treadCount = 8;
          for (let step = 0; step < treadCount; step++) {
            const inset = 4 + step * Math.min(1.4, w / 90);
            const treadY = y + 5 + step * ((h - 10) / treadCount);
            ctx.fillStyle = step % 2 ? "#c8ccc7" : "#eef0ec";
            ctx.fillRect(x + inset, treadY, Math.max(2, w - inset * 2), Math.max(2, h / treadCount - 1));
            ctx.strokeStyle = "#52635d";
            ctx.strokeRect(x + inset, treadY, Math.max(2, w - inset * 2), Math.max(2, h / treadCount - 1));
          }
          ctx.strokeStyle = "#dbe0dc";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x + w * .18, y + h * .85);
          ctx.lineTo(x + w * .18, y + h * .18);
          ctx.lineTo(x + w * .12, y + h * .28);
          ctx.moveTo(x + w * .18, y + h * .18);
          ctx.lineTo(x + w * .24, y + h * .28);
          ctx.stroke();
        }
        ctx.fillStyle = "#344d45";
        ctx.font = `800 ${Math.max(5, Math.min(9, w / 4))}px Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        if (kind !== "stairs") ctx.fillText(kind.toUpperCase(), x + w / 2, y + h / 2, w - 4);
        ctx.restore();
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    return () => observer.disconnect();
  }, [floor, view, recommendedIds, selectedIds, matchingIds]);

  return <canvas ref={canvasRef} className="floor-plan-canvas" aria-hidden="true" />;
}

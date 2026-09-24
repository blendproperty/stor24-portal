"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Armchair,
  Box,
  Copy,
  DoorOpen,
  Eye,
  Grid3X3,
  PanelsTopLeft,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Square,
  SquareDashed,
  Table2,
  Tag,
  Trash2,
  Type,
  Warehouse,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { moveLayer, type LayerMove } from "@/lib/layer-order";

type UnitType = {
  id: string;
  name: string;
  widthMetres: string | null;
  lengthMetres: string | null;
  areaSqMetres: string | null;
};
type Unit = {
  id: string;
  number: string;
  status: string;
  floorOperational?: boolean;
  monthlyRate: string;
  unitTypeId: string;
  unitType: UnitType;
};
type SavedElement = {
  id: string;
  unitId: string | null;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
  unit: Unit | null;
  config?: unknown;
};
type MapRecord = {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: SavedElement[];
};
type Facility = {
  id: string;
  name: string;
  code: string;
  unitTypes: UnitType[];
  units: Unit[];
  maps: MapRecord[];
};
type ElementType = "UNIT" | "ZONE" | "WALL" | "FIRE_WALL" | "PARTITION_WALL" | "DOOR" | "WINDOW" | "LABEL" | "ROLLER_SHUTTER" | "SINGLE_DOOR" | "DOUBLE_DOOR" | "STAIRS" | "RETURN_STAIRS" | "LIFT" | "TABLE" | "CHAIR" | "CUPBOARD" | "ROOF";
type DraftUnit = {
  unitTypeId: string;
  number: string;
  floor?: string;
  zone?: string;
  monthlyRate: number;
  taxRate: number;
};
type CanvasElement = {
  id: string;
  unitId?: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
  status?: string;
  unit?: DraftUnit;
  unitDetails?: Unit;
  mirrored?: boolean;
  flippedVertical?: boolean;
};

const snap = (value: number) => Math.max(0, Math.round(value / 10) * 10);
const freshId = () => `draft-${crypto.randomUUID()}`;
const defaultCanvasSize = { width: 3000, height: 1800 };
const elementDefaults: Record<
  Exclude<ElementType, "UNIT">,
  Pick<CanvasElement, "width" | "height" | "label">
> = {
  ZONE: { width: 260, height: 180, label: "Zone" },
  WALL: { width: 240, height: 14, label: "Wall" },
  FIRE_WALL: { width: 240, height: 14, label: "Fire wall" },
  PARTITION_WALL: { width: 240, height: 4, label: "Partition wall" },
  DOOR: { width: 100, height: 60, label: "Door" },
  WINDOW: { width: 100, height: 12, label: "Window" },
  LABEL: { width: 180, height: 44, label: "Label" },
  ROLLER_SHUTTER: { width: 140, height: 36, label: "Roller shutter" },
  SINGLE_DOOR: { width: 70, height: 70, label: "Single door" },
  DOUBLE_DOOR: { width: 110, height: 60, label: "Double door" },
  STAIRS: { width: 140, height: 90, label: "Stairs" },
  RETURN_STAIRS: { width: 180, height: 140, label: "Return stairs" },
  LIFT: { width: 90, height: 90, label: "Lift" },
  TABLE: { width: 120, height: 70, label: "Table" },
  CHAIR: { width: 50, height: 50, label: "Chair" },
  CUPBOARD: { width: 100, height: 45, label: "Cupboard" },
  ROOF: { width: 600, height: 400, label: "ROOF" },
};

export function FacilityMapEditor() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState("");
  const [floorName, setFloorName] = useState("");
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [canvasSize, setCanvasSize] = useState(defaultCanvasSize);
  const [selectedId, setSelectedId] = useState("");
  const [zoom, setZoom] = useState(0.8);
  const [unitDialog, setUnitDialog] = useState(false);
  const [duplicateDialog, setDuplicateDialog] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [mode, setMode] = useState<"build" | "live">("build");
  const [expanded, setExpanded] = useState(false);
  const mapScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);
  const resizeRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const facility = facilities.find((item) => item.id === facilityId);
  const selected = elements.find((item) => item.id === selectedId);
  const selectedLayerIndex = selected
    ? elements.findIndex((item) => item.id === selected.id)
    : -1;
  const maps = facility?.maps ?? [];
  const currentMap = maps.find((map) => map.name === floorName);
  const placedUnitIds = useMemo(
    () =>
      new Set(
        facilities.flatMap((item) =>
          item.maps.flatMap(
            (map) =>
              map.elements
                .map((element) => element.unitId)
                .filter(Boolean) as string[],
          ),
        ),
      ),
    [facilities],
  );
  const unavailableUnitIds = useMemo(
    () =>
      new Set([
        ...placedUnitIds,
        ...elements.flatMap((element) =>
          element.unitId ? [element.unitId] : [],
        ),
      ]),
    [placedUnitIds, elements],
  );
  const statusCounts = useMemo(
    () => ({
      available: elements.filter((element) => element.status === "AVAILABLE" && element.unitDetails?.floorOperational !== false)
        .length,
      reserved: elements.filter((element) =>
        ["RESERVED", "HELD"].includes(element.status || ""),
      ).length,
      occupied: elements.filter((element) => element.status === "OCCUPIED")
        .length,
      service: elements.filter((element) =>
        ["SERVICE", "UNAVAILABLE"].includes(element.status || ""),
      ).length,
    }),
    [elements],
  );

  const load = useCallback(
    async (
      preferredFacility?: string,
      preferredFloor?: string,
      preserveSelection = false,
    ) => {
      const response = await fetch("/api/v1/facility-map", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Layouts could not be loaded.");
        return;
      }
      setFacilities(payload.data);
      const nextFacilityId =
        preferredFacility || facilityId || payload.data[0]?.id || "";
      setFacilityId(nextFacilityId);
      const nextFacility = payload.data.find(
        (item: Facility) => item.id === nextFacilityId,
      );
      const nextFloor =
        preferredFloor ||
        floorName ||
        nextFacility?.maps[0]?.name ||
        "Ground floor";
      setFloorName(nextFloor);
      hydrate(
        nextFacility?.maps.find((map: MapRecord) => map.name === nextFloor),
        preserveSelection,
      );
      setLastUpdated(new Date());
    },
    [facilityId, floorName],
  );
  useEffect(() => {
    let active = true;
    fetch("/api/v1/facility-map", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok) {
          setError(payload.error?.message ?? "Layouts could not be loaded.");
          return;
        }
        const nextFacility: Facility | undefined = payload.data[0];
        const nextFloor = nextFacility?.maps[0]?.name || "Ground floor";
        setFacilities(payload.data);
        setFacilityId(nextFacility?.id || "");
        setFloorName(nextFloor);
        hydrate(nextFacility?.maps[0]);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (mode !== "live" || !facilityId) return;
    const interval = window.setInterval(() => {
      void load(facilityId, floorName, true);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [mode, facilityId, floorName, load]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        !selectedId ||
        mode !== "build" ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(
          (event.target as HTMLElement).tagName,
        )
      )
        return;
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-10, 0],
        ArrowRight: [10, 0],
        ArrowUp: [0, -10],
        ArrowDown: [0, 10],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      const step = event.shiftKey ? 1 : 10;
      setElements((items) =>
        items.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                x: Math.max(0, item.x + Math.sign(direction[0]) * step),
                y: Math.max(0, item.y + Math.sign(direction[1]) * step),
              }
            : item,
        ),
      );
      setDirty(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, mode]);

  function hydrate(map?: MapRecord, preserveSelection = false) {
    const hasLegacyRotation = Boolean(
      map?.elements.some(
        (element) =>
          ["WALL", "FIRE_WALL", "PARTITION_WALL", "WINDOW"].includes(element.type) &&
          element.rotation % 180 !== 0,
      ),
    );
    setCanvasSize(
      map
        ? {
            width: Math.max(map.width, defaultCanvasSize.width),
            height: Math.max(map.height, defaultCanvasSize.height),
          }
        : defaultCanvasSize,
    );
    setElements(
      map?.elements.map((element) => ({
        id: element.id,
        unitId: element.unitId ?? undefined,
        type: element.type,
        x: element.x,
        y: element.y,
        width:
          ["WALL", "FIRE_WALL", "PARTITION_WALL", "WINDOW"].includes(element.type) &&
          element.rotation % 180 !== 0
            ? element.height
            : element.width,
        height:
          ["WALL", "FIRE_WALL", "PARTITION_WALL", "WINDOW"].includes(element.type) &&
          element.rotation % 180 !== 0
            ? element.width
            : element.height,
        rotation: ["WALL", "FIRE_WALL", "PARTITION_WALL", "WINDOW"].includes(element.type)
          ? 0
          : element.rotation,
        label: element.label || element.unit?.number || element.type,
        status: element.unit?.status,
        unitDetails: element.unit ?? undefined,
        mirrored:
          typeof element.config === "object" &&
          element.config !== null &&
          "mirrored" in element.config
            ? Boolean((element.config as { mirrored?: unknown }).mirrored)
            : false,
        flippedVertical:
          typeof element.config === "object" &&
          element.config !== null &&
          "flippedVertical" in element.config
            ? Boolean((element.config as { flippedVertical?: unknown }).flippedVertical)
            : false,
      })) ?? [],
    );
    if (!preserveSelection) setSelectedId("");
    setDirty(hasLegacyRotation);
  }
  function selectFacility(nextId: string) {
    if (dirty && !confirm("Discard unsaved layout changes?")) return;
    const next = facilities.find((item) => item.id === nextId);
    const nextFloor = next?.maps[0]?.name || "Ground floor";
    setFacilityId(nextId);
    setFloorName(nextFloor);
    hydrate(next?.maps[0]);
  }
  function selectFloor(nextFloor: string) {
    if (dirty && !confirm("Discard unsaved layout changes?")) return;
    setFloorName(nextFloor);
    hydrate(maps.find((map) => map.name === nextFloor));
  }
  function addFloor() {
    const name = prompt(
      "Name this floor or layout",
      `Floor ${maps.length + 1}`,
    )?.trim();
    if (
      !name ||
      maps.some((map) => map.name.toLowerCase() === name.toLowerCase())
    )
      return;
    setFloorName(name);
    hydrate();
    setDirty(true);
  }
  function addShape(type: Exclude<ElementType, "UNIT">) {
    const defaults = elementDefaults[type];
    const position = visibleCanvasPosition(defaults.width, defaults.height);
    const element = {
      id: freshId(),
      type,
      ...position,
      rotation: 0,
      ...defaults,
    };
    setElements((items) => [...items, element]);
    setSelectedId(element.id);
    setDirty(true);
  }
  function visibleCanvasPosition(width: number, height: number) {
    const viewport = mapScrollRef.current;
    if (!viewport) return { x: 100, y: 100 };
    const centreX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom;
    const centreY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
    return {
      x: snap(Math.max(0, Math.min(canvasSize.width - width, centreX - width / 2))),
      y: snap(Math.max(0, Math.min(canvasSize.height - height, centreY - height / 2))),
    };
  }
  function patchElement(id: string, patch: Partial<CanvasElement>) {
    setElements((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setDirty(true);
  }
  function nudgeSelected(dx: number, dy: number) {
    if (!selected) return;
    patchElement(selected.id, {
      x: Math.max(0, selected.x + dx),
      y: Math.max(0, selected.y + dy),
    });
  }
  function moveSelectedLayer(move: LayerMove) {
    if (!selected) return;
    setElements((items) => moveLayer(items, selected.id, move));
    setDirty(true);
  }
  async function duplicateFloor(targetName: string) {
    if (!facilityId || !currentMap) return;
    if (dirty) {
      setError("Save the current floor before duplicating it.");
      return;
    }
    if (!targetName) return;

    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/v1/facility-map/duplicate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        facilityId,
        sourceName: floorName,
        targetName,
        excludeRoof: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(payload.error?.message ?? "The floor could not be duplicated.");
      return;
    }
    setDuplicateDialog(false);
    await load(facilityId, targetName);
    setNotice(
      `${targetName} created with ${payload.data.elementCount} objects and ${payload.data.unitCount} new units (${payload.data.firstUnitNumber}–${payload.data.lastUnitNumber}).`,
    );
  }
  function expandCanvas(axis: "width" | "height") {
    setCanvasSize((current) => ({
      ...current,
      [axis]: Math.min(5000, current[axis] + (axis === "width" ? 600 : 400)),
    }));
    setDirty(true);
  }
  function rotateSelected(degrees = 90) {
    if (!selected) return;
    if (["DOOR", "SINGLE_DOOR", "DOUBLE_DOOR", "STAIRS", "RETURN_STAIRS"].includes(selected.type)) {
      patchElement(selected.id, {
        rotation: (selected.rotation + degrees) % 360,
      });
      return;
    }
    patchElement(selected.id, {
      width: selected.height,
      height: selected.width,
      rotation: 0,
    });
  }
  function removeSelected() {
    if (!selected) return;
    setElements((items) => items.filter((item) => item.id !== selected.id));
    setSelectedId("");
    setDirty(true);
  }
  function duplicateSelected() {
    if (!selected || selected.type === "UNIT") return;
    const duplicate: CanvasElement = {
      ...selected,
      id: freshId(),
      x: Math.min(canvasSize.width - selected.width, selected.x + 20),
      y: Math.min(canvasSize.height - selected.height, selected.y + 20),
      label: selected.label,
    };
    setElements((items) => [...items, duplicate]);
    setSelectedId(duplicate.id);
    setDirty(true);
  }
  function placeUnit(unit: Unit | null, draft?: DraftUnit) {
    const label = unit?.number || draft?.number || "Unit";
    const type = facility?.unitTypes.find(
      (item) => item.id === (unit?.unitTypeId || draft?.unitTypeId),
    );
    const scale = 45;
    const width = type?.widthMetres
      ? Math.max(40, Number(type.widthMetres) * scale)
      : 100;
    const height = type?.lengthMetres
      ? Math.max(40, Number(type.lengthMetres) * scale)
      : 90;
    const snappedWidth = snap(width);
    const snappedHeight = snap(height);
    const position = visibleCanvasPosition(snappedWidth, snappedHeight);
    const element: CanvasElement = {
      id: freshId(),
      unitId: unit?.id,
      unit: draft,
      type: "UNIT",
      ...position,
      width: snappedWidth,
      height: snappedHeight,
      rotation: 0,
      label,
      status: unit?.status || "AVAILABLE",
    };
    setElements((items) => [...items, element]);
    setSelectedId(element.id);
    setUnitDialog(false);
    setDirty(true);
  }

  async function save() {
    if (!facilityId || !floorName) return;
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/v1/facility-map", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        facilityId,
        name: floorName,
        ...canvasSize,
        elements: elements.map((element) => ({
          ...element,
          label: element.label.slice(0, 120),
          status: undefined,
          unitDetails: undefined,
        })),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      const fieldMessage = payload.error?.fields
        ? Object.entries(payload.error.fields as Record<string, string[]>)
            .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))
            .join(" ")
        : "";
      setError(
        payload.error?.message ??
          (fieldMessage ||
            (response.status === 409
              ? "A unit number is duplicated or already placed on another floor."
              : "The layout could not be saved.")),
      );
      return;
    }
    const savedMapInfo = payload.data.map as Omit<MapRecord, "elements">;
    const createdUnits = payload.data.createdUnits as Array<{
      elementId: string;
      unit: Unit;
    }>;
    const updatedElements = elements.map((element) => {
      const created = createdUnits.find((item) => item.elementId === element.id);
      return created
        ? {
            ...element,
            unitId: created.unit.id,
            unit: undefined,
            unitDetails: created.unit,
            status: created.unit.status,
          }
        : element;
    });
    const savedMap: MapRecord = {
      ...savedMapInfo,
      elements: updatedElements.map((element) => ({
        id: element.id,
        unitId: element.unitId ?? null,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        label: element.label,
        unit: element.unitDetails ?? null,
        config: {
          mirrored: element.mirrored,
          flippedVertical: element.flippedVertical,
        },
      })),
    };
    setElements(updatedElements);
    setFacilities((current) =>
      current.map((item) => {
        if (item.id !== facilityId) return item;
        const savedUnits = savedMap.elements.flatMap((element) =>
          element.unit ? [element.unit] : [],
        );
        return {
          ...item,
          units: [
            ...item.units.filter(
              (unit) => !savedUnits.some((saved) => saved.id === unit.id),
            ),
            ...savedUnits,
          ],
          maps: item.maps.some((map) => map.id === savedMap.id)
            ? item.maps.map((map) =>
                map.id === savedMap.id ? savedMap : map,
              )
            : [...item.maps, savedMap],
        };
      }),
    );
    setDirty(false);
    setLastUpdated(new Date());
    setNotice(`${floorName} saved to ${facility?.name}.`);
  }

  return (
    <div
      className={`page-stack map-editor-workspace ${expanded ? "map-editor-expanded" : ""}`}
    >
      <PageHeader
        eyebrow="Visual inventory"
        title={mode === "build" ? "Facility map builder" : "Live facility map"}
        description={
          mode === "build"
            ? "Draw and save a separate interactive unit layout for every store and floor."
            : "Read-only operational view showing the current status of every mapped unit."
        }
        action={
          <div className="form-actions">
            <button
              className="button button-secondary"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{" "}
              {expanded ? "Exit large workspace" : "Large workspace"}
            </button>
            {mode === "build" ? (
              <button
                className="button button-primary"
                onClick={save}
                disabled={!dirty || busy}
              >
                <Save size={16} />
                {busy ? "Saving…" : "Save layout"}
              </button>
            ) : null}
          </div>
        }
      />
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}
      <section className="panel map-editor-header">
        <div className="map-mode-switch">
          <button
            className={mode === "build" ? "active" : ""}
            onClick={() => setMode("build")}
          >
            <Pencil size={14} />
            Build layout
          </button>
          <button
            className={mode === "live" ? "active" : ""}
            onClick={() => {
              if (
                dirty &&
                !confirm("Open live view and discard unsaved changes?")
              )
                return;
              setMode("live");
              void load(facilityId, floorName);
            }}
          >
            <Eye size={14} />
            Live view
          </button>
        </div>
        <label>
          Store
          <select
            value={facilityId}
            onChange={(event) => selectFacility(event.target.value)}
          >
            {facilities.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Floor / layout
          <select
            value={floorName}
            onChange={(event) => selectFloor(event.target.value)}
          >
            {maps.map((map) => (
              <option value={map.name} key={map.id}>
                {map.name}
              </option>
            ))}
            {!currentMap && floorName ? (
              <option value={floorName}>{floorName} — unsaved</option>
            ) : null}
          </select>
        </label>
        {mode === "build" ? (
          <>
            <button className="button button-secondary" onClick={addFloor}>
              <Plus size={15} />
              Add floor
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                const defaultTarget = maps.find((map) => map.name === "Second Floor" && map.name !== floorName)?.name ?? maps.find((map) => map.name !== floorName)?.name ?? "";
                setDuplicateTarget(defaultTarget);
                setDuplicateDialog(true);
              }}
              disabled={!currentMap || busy}
            >
              <Copy size={15} />
              Duplicate floor
            </button>
          </>
        ) : null}
        <span className="map-save-state">
          {mode === "live"
            ? "Operational status"
            : dirty
              ? "Unsaved changes"
              : currentMap
                ? "Saved"
                : "New layout"}
        </span>
      </section>
      <section
        className={`map-editor-shell ${mode === "live" ? "map-live-shell" : ""}`}
      >
        {mode === "build" ? (
          <aside className="panel map-toolbox">
            <h2>Toolbox</h2>
            <Tool icon={<MousePointer2 />} label="Select" />
            <Tool
              icon={<Box />}
              label="Unit"
              action={() => setUnitDialog(true)}
              draggable
            />
            <Tool
              icon={<SquareDashed />}
              label="Zone"
              action={() => addShape("ZONE")}
              draggable
            />
            <Tool
              icon={<Grid3X3 />}
              label="Normal wall"
              type="WALL"
              action={() => addShape("WALL")}
              draggable
            />
            <Tool
              icon={<Grid3X3 />}
              label="Fire wall"
              type="FIRE_WALL"
              action={() => addShape("FIRE_WALL")}
              draggable
            />
            <Tool
              icon={<Grid3X3 />}
              label="Partition wall"
              type="PARTITION_WALL"
              action={() => addShape("PARTITION_WALL")}
              draggable
            />
            <Tool
              icon={<DoorOpen />}
              label="Single door"
              type="SINGLE_DOOR"
              action={() => addShape("SINGLE_DOOR")}
              draggable
            />
            <Tool
              icon={<DoorOpen />}
              label="Double door"
              type="DOUBLE_DOOR"
              action={() => addShape("DOUBLE_DOOR")}
              draggable
            />
            <Tool
              icon={<PanelsTopLeft />}
              label="Roller shutter"
              type="ROLLER_SHUTTER"
              action={() => addShape("ROLLER_SHUTTER")}
              draggable
            />
            <Tool
              icon={<Square />}
              label="Window"
              action={() => addShape("WINDOW")}
              draggable
            />
            <Tool icon={<Grid3X3 />} label="Straight stairs" type="STAIRS" action={() => addShape("STAIRS")} draggable />
            <Tool icon={<Grid3X3 />} label="Return stairs" type="RETURN_STAIRS" action={() => addShape("RETURN_STAIRS")} draggable />
            <Tool icon={<Square />} label="Lift" type="LIFT" action={() => addShape("LIFT")} draggable />
            <Tool icon={<Table2 />} label="Table" type="TABLE" action={() => addShape("TABLE")} draggable />
            <Tool icon={<Armchair />} label="Chair" type="CHAIR" action={() => addShape("CHAIR")} draggable />
            <Tool icon={<Box />} label="Cupboard" type="CUPBOARD" action={() => addShape("CUPBOARD")} draggable />
            <Tool icon={<PanelsTopLeft />} label="Roof" type="ROOF" action={() => addShape("ROOF")} draggable />
            <Tool
              icon={<Type />}
              label="Label"
              action={() => addShape("LABEL")}
              draggable
            />
            <hr />
            <Link href="/units" className="map-tool-link">
              <Warehouse size={16} />
              Manage unit types
            </Link>
          </aside>
        ) : (
          <aside className="panel map-legend">
            <h2>Unit status</h2>
            {[
              ["available", "Available"],
              ["reserved", "Reserved / held"],
              ["occupied", "Occupied"],
              ["service", "Service / unavailable"],
            ].map(([tone, label]) => (
              <div key={tone}>
                <i className={`map-legend-${tone}`} />
                <span>{label}</span>
                <strong>
                  {statusCounts[tone as keyof typeof statusCounts]}
                </strong>
              </div>
            ))}
            <small>
              Updates automatically every 15 seconds
              {lastUpdated
                ? ` · ${lastUpdated.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                : ""}
            </small>
          </aside>
        )}
        <div className="panel map-stage">
          <div className="map-stage-toolbar">
            <div className="map-canvas-controls">
              <span>{floorName || "Layout"}</span>
              <small>{canvasSize.width} × {canvasSize.height}px</small>
              {mode === "build" ? (
                <>
                  <button type="button" onClick={() => expandCanvas("width")}>Wider +600</button>
                  <button type="button" onClick={() => expandCanvas("height")}>Taller +400</button>
                </>
              ) : null}
            </div>
            <div>
              <button
                onClick={() => setZoom((value) => Math.max(0.4, value - 0.1))}
              >
                <ZoomOut size={15} />
              </button>
              <b>{Math.round(zoom * 100)}%</b>
              <button
                onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
              >
                <ZoomIn size={15} />
              </button>
            </div>
          </div>
          <div className="map-scroll" ref={mapScrollRef}>
            <div
              className="map-canvas"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
              onClick={() => setSelectedId("")}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const type = event.dataTransfer.getData(
                  "application/map-tool",
                ) as ElementType;
                if (type === "UNIT") setUnitDialog(true);
                else if (type) addShape(type);
              }}
            >
              {elements.map((element, layerIndex) => (
                <div
                  key={element.id}
                  className={`map-editor-element map-editor-${element.type.toLowerCase()} ${selectedId === element.id ? "selected" : ""} ${element.status ? `map-status-${element.status.toLowerCase()}` : ""} ${mode === "live" ? "live" : ""}`}
                  style={{
                    left: element.x,
                    top: element.y,
                    width: element.width,
                    height: element.height,
                    zIndex: layerIndex + 1,
                    transform:
                      ["DOOR", "SINGLE_DOOR", "DOUBLE_DOOR", "STAIRS", "RETURN_STAIRS"].includes(element.type)
                        ? undefined
                        : `rotate(${element.rotation}deg)`,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(element.id);
                  }}
                  onPointerDown={(event) => {
                    if (
                      mode !== "build" ||
                      (event.target as HTMLElement).classList.contains(
                        "map-resize-handle",
                      )
                    )
                      return;
                    dragRef.current = {
                      id: element.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      x: element.x,
                      y: element.y,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const drag = dragRef.current;
                    if (
                      mode === "build" &&
                      drag?.id === element.id &&
                      event.buttons
                    )
                      patchElement(element.id, {
                        x: snap(drag.x + (event.clientX - drag.startX) / zoom),
                        y: snap(drag.y + (event.clientY - drag.startY) / zoom),
                      });
                  }}
                  onPointerUp={() => {
                    dragRef.current = null;
                  }}
                >
                  <MapElementSymbol element={element} />
                  {element.type === "UNIT" ? (
                    <>
                      <small className="map-unit-area">
                        {formatUnitArea(
                          element.unitDetails?.unitType ||
                            facility?.unitTypes.find(
                              (type) => type.id === element.unit?.unitTypeId,
                            ),
                        )}
                      </small>
                      <small>{element.status?.toLowerCase()}</small>
                    </>
                  ) : null}
                  {mode === "build" ? (
                    <i
                      className="map-resize-handle"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        resizeRef.current = {
                          id: element.id,
                          startX: event.clientX,
                          startY: event.clientY,
                          width: element.width,
                          height: element.height,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const resize = resizeRef.current;
                        if (resize?.id === element.id && event.buttons)
                          patchElement(element.id, {
                            width: Math.max(
                              element.type === "UNIT" ? 30 : element.type === "PARTITION_WALL" ? 2 : 10,
                              snap(
                                resize.width +
                                  (event.clientX - resize.startX) / zoom,
                              ),
                            ),
                            height: Math.max(
                              element.type === "UNIT" ? 20 : element.type === "PARTITION_WALL" ? 2 : 10,
                              snap(
                                resize.height +
                                  (event.clientY - resize.startY) / zoom,
                              ),
                            ),
                          });
                      }}
                      onPointerUp={() => {
                        resizeRef.current = null;
                      }}
                    />
                  ) : null}
                </div>
              ))}
              {!elements.length ? (
                <div className="map-canvas-empty">
                  <Grid3X3 size={35} />
                  <strong>Start building {floorName}</strong>
                  <p>
                    Drag a tool here or click Unit, Zone, Wall, Door or Label.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {mode === "build" ? (
          <aside className="panel map-properties">
            <h2>Properties</h2>
            {selected ? (
              <>
                <label>
                  Label
                  <input
                    value={selected.label}
                    maxLength={120}
                    onChange={(event) =>
                      patchElement(selected.id, { label: event.target.value })
                    }
                  />
                </label>
                <div className="map-nudge">
                  <button onClick={() => nudgeSelected(0, -10)}>
                    <ArrowUp />
                  </button>
                  <button onClick={() => nudgeSelected(-10, 0)}>
                    <ArrowLeft />
                  </button>
                  <button onClick={() => nudgeSelected(0, 10)}>
                    <ArrowDown />
                  </button>
                  <button onClick={() => nudgeSelected(10, 0)}>
                    <ArrowRight />
                  </button>
                </div>
                {["WALL", "FIRE_WALL", "PARTITION_WALL", "DOOR", "SINGLE_DOOR", "DOUBLE_DOOR", "ROLLER_SHUTTER", "WINDOW", "STAIRS", "RETURN_STAIRS", "LIFT", "TABLE", "CHAIR", "CUPBOARD", "ROOF"].includes(selected.type) ? (
                  <button
                    type="button"
                    className="map-rotate-button"
                    onClick={() => rotateSelected(90)}
                  >
                    <RotateCw size={15} /> Rotate 90°
                  </button>
                ) : null}
                {["DOOR", "SINGLE_DOOR", "DOUBLE_DOOR"].includes(selected.type) ? (
                  <>
                    <button
                      type="button"
                      className="map-rotate-button"
                      onClick={() => rotateSelected(180)}
                    >
                      <RotateCw size={15} /> Rotate 180°
                    </button>
                    <button
                      type="button"
                      className="map-rotate-button"
                      onClick={() => patchElement(selected.id, { mirrored: !selected.mirrored })}
                    >
                      <ArrowLeft size={15} /> Flip left / right
                    </button>
                    <button
                      type="button"
                      className="map-rotate-button"
                      onClick={() => patchElement(selected.id, { flippedVertical: !selected.flippedVertical })}
                    >
                      <ArrowUp size={15} /> Flip up / down
                    </button>
                  </>
                ) : null}
                <small className="map-nudge-help">
                  Arrow keys move 10 px · Shift + arrow moves 1 px
                </small>
                <div className="map-layer-controls">
                  <strong>Layer order</strong>
                  <div>
                    <button
                      type="button"
                      disabled={selectedLayerIndex <= 0}
                      onClick={() => moveSelectedLayer("back")}
                    >
                      <ArrowDown size={14} /> Send to back
                    </button>
                    <button
                      type="button"
                      disabled={selectedLayerIndex <= 0}
                      onClick={() => moveSelectedLayer("backward")}
                    >
                      <ArrowDown size={14} /> Move backward
                    </button>
                    <button
                      type="button"
                      disabled={selectedLayerIndex >= elements.length - 1}
                      onClick={() => moveSelectedLayer("forward")}
                    >
                      <ArrowUp size={14} /> Move forward
                    </button>
                    <button
                      type="button"
                      disabled={selectedLayerIndex >= elements.length - 1}
                      onClick={() => moveSelectedLayer("front")}
                    >
                      <ArrowUp size={14} /> Bring to front
                    </button>
                  </div>
                </div>
                <div className="map-property-grid">
                  <label>
                    X
                    <input
                      key={`${selected.id}-x-${selected.x}`}
                      type="number"
                      defaultValue={selected.x}
                      onBlur={(event) =>
                        patchElement(selected.id, {
                          x: snap(Number(event.target.value)),
                        })
                      }
                      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      key={`${selected.id}-y-${selected.y}`}
                      type="number"
                      defaultValue={selected.y}
                      onBlur={(event) =>
                        patchElement(selected.id, {
                          y: snap(Number(event.target.value)),
                        })
                      }
                      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    />
                  </label>
                  <label>
                    Width
                    <input
                      key={`${selected.id}-width-${selected.width}`}
                      type="number"
                      defaultValue={selected.width}
                      onBlur={(event) =>
                        patchElement(selected.id, {
                          width: Math.max(selected.type === "PARTITION_WALL" ? 2 : 10, Number(event.target.value)),
                        })
                      }
                      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    />
                  </label>
                  <label>
                    Height
                    <input
                      key={`${selected.id}-height-${selected.height}`}
                      type="number"
                      defaultValue={selected.height}
                      onBlur={(event) =>
                        patchElement(selected.id, {
                          height: Math.max(selected.type === "PARTITION_WALL" ? 2 : 10, Number(event.target.value)),
                        })
                      }
                      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    />
                  </label>
                </div>
                {selected.type === "PARTITION_WALL" ? (
                  <label>
                    Line thickness (2–6 px)
                    <input
                      type="number"
                      min={2}
                      max={6}
                      value={Math.min(selected.width, selected.height)}
                      onChange={(event) => {
                        const thickness = Math.max(2, Math.min(6, Number(event.target.value)));
                        patchElement(
                          selected.id,
                          selected.width >= selected.height
                            ? { height: thickness }
                            : { width: thickness },
                        );
                      }}
                    />
                  </label>
                ) : null}
                {["STAIRS", "RETURN_STAIRS"].includes(selected.type) ? (
                  <>
                    <button
                      type="button"
                      className="map-rotate-button"
                      onClick={() => patchElement(selected.id, { mirrored: !selected.mirrored })}
                    >
                      <ArrowLeft size={15} /> Flip left / right
                    </button>
                    <button
                      type="button"
                      className="map-rotate-button"
                      onClick={() => patchElement(selected.id, { flippedVertical: !selected.flippedVertical })}
                    >
                      <ArrowUp size={15} /> Flip up / down
                    </button>
                  </>
                ) : null}
                {selected.type === "UNIT" ? (
                  <p className="map-property-note">
                    <Tag size={14} />
                    {selected.status || "Draft unit"}
                  </p>
                ) : null}
                {selected.type !== "UNIT" ? (
                  <button
                    type="button"
                    className="button button-secondary map-duplicate-button"
                    onClick={duplicateSelected}
                  >
                    <Copy size={15} /> Duplicate object
                  </button>
                ) : null}
                <button
                  className="button button-danger"
                  onClick={removeSelected}
                >
                  <Trash2 size={15} />
                  Remove from layout
                </button>
              </>
            ) : (
              <div className="empty-cell">
                Select an element to edit it. You can also use the keyboard
                arrow keys.
              </div>
            )}
          </aside>
        ) : (
          <aside className="panel map-live-details">
            <h2>Unit details</h2>
            {selected?.unitDetails ? (
              <>
                <div>
                  <span>Unit</span>
                  <strong>{selected.unitDetails.number}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>
                    {selected.unitDetails.floorOperational === false ? "Floor under construction" : selected.unitDetails.status
                      .toLowerCase()
                      .replaceAll("_", " ")}
                  </strong>
                </div>
                <div>
                  <span>Type</span>
                  <strong>{selected.unitDetails.unitType.name}</strong>
                </div>
                <div>
                  <span>Nominal dimensions</span>
                  <strong>
                    {[
                      selected.unitDetails.unitType.widthMetres,
                      selected.unitDetails.unitType.lengthMetres,
                    ]
                      .filter(Boolean)
                      .join(" × ") || "—"}{" "}
                    m
                  </strong>
                </div>
                <div>
                  <span>Area</span>
                  <strong>{formatUnitArea(selected.unitDetails.unitType)}</strong>
                </div>
                <div>
                  <span>Monthly rate</span>
                  <strong>
                    {Number(selected.unitDetails.monthlyRate).toLocaleString(
                      "en-ZA",
                      { style: "currency", currency: "ZAR" },
                    )}
                  </strong>
                </div>
                <Link href="/units" className="button button-secondary">
                  Open unit record
                </Link>
                {selected.unitDetails.status === "AVAILABLE" && selected.unitDetails.floorOperational !== false ? (
                  <Link href="/reservations" className="button button-primary">
                    Reserve this unit
                  </Link>
                ) : null}
              </>
            ) : (
              <div className="empty-cell">
                Select a mapped unit to see its live operational record.
              </div>
            )}
          </aside>
        )}
      </section>
      {unitDialog && facility ? (
        <UnitPlacementDialog
          facility={facility}
          placedUnitIds={unavailableUnitIds}
          floorName={floorName}
          draftNumbers={elements.flatMap((element) =>
            element.unit ? [element.unit.number] : [],
          )}
          close={() => setUnitDialog(false)}
          place={placeUnit}
        />
      ) : null}
      {duplicateDialog ? (
        <div className="modal-backdrop">
          <div className="modal-card map-duplicate-modal">
            <button className="modal-close" onClick={() => setDuplicateDialog(false)}>
              <X size={18} />
            </button>
            <p className="eyebrow">Facility map</p>
            <h2>Duplicate {floorName}</h2>
            <p className="modal-copy">
              Copies the latest saved objects and layout. Roof objects are excluded and new sequential unit numbers are assigned. A destination containing objects will not be overwritten.
            </p>
            <label>
              Destination floor
              <select value={duplicateTarget} onChange={(event) => setDuplicateTarget(event.target.value)}>
                {maps.filter((map) => map.name !== floorName).map((map) => (
                  <option value={map.name} key={map.id}>{map.name}</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setDuplicateDialog(false)} disabled={busy}>Cancel</button>
              <button className="button button-primary" onClick={() => void duplicateFloor(duplicateTarget)} disabled={!duplicateTarget || busy}>
                {busy ? "Duplicating…" : "Duplicate floor"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MapElementSymbol({ element }: { element: CanvasElement }) {
  const rotation = {
    transform: `rotate(${element.rotation}deg) scaleX(${element.mirrored ? -1 : 1}) scaleY(${element.flippedVertical ? -1 : 1})`,
  };
  if (["WALL", "FIRE_WALL", "PARTITION_WALL"].includes(element.type)) return null;
  if (element.type === "SINGLE_DOOR") {
    return (
      <svg className="map-door-swing" viewBox="0 0 100 100" style={rotation} aria-label={element.label}>
        <path className="map-door-wall" d="M 8 0 V 10 M 8 90 V 100" />
        <path className="map-door-leaf" d="M 8 10 H 88" />
        <path className="map-door-arc" d="M 88 10 A 80 80 0 0 1 8 90" />
        <circle cx="8" cy="10" r="2.2" />
      </svg>
    );
  }
  if (element.type === "DOOR" || element.type === "DOUBLE_DOOR") {
    return (
      <svg className="map-door-swing" viewBox="0 0 100 60" style={rotation} aria-label={element.label}>
        <path className="map-door-wall" d="M 0 5 H 20 M 80 5 H 100" />
        <path className="map-door-leaf" d="M 20 5 V 35 M 80 5 V 35" />
        <path className="map-door-arc" d="M 20 35 A 30 30 0 0 0 50 5 M 80 35 A 30 30 0 0 1 50 5" />
        <circle cx="20" cy="5" r="2.2" /><circle cx="80" cy="5" r="2.2" />
      </svg>
    );
  }
  if (element.type === "ROLLER_SHUTTER") {
    return <svg className="map-fixture-symbol" viewBox="0 0 100 40" aria-label={element.label}><rect x="2" y="3" width="96" height="34" rx="2" /><path d="M 5 10 H 95 M 5 17 H 95 M 5 24 H 95 M 5 31 H 95" /></svg>;
  }
  if (element.type === "STAIRS") {
    return <svg className="map-fixture-symbol" viewBox="0 0 120 80" style={rotation} aria-label={element.label}><rect x="2" y="2" width="116" height="76" /><path d="M 12 68 H 108 M 12 58 H 108 M 12 48 H 108 M 12 38 H 108 M 12 28 H 108 M 12 18 H 108 M 60 67 V 15 M 52 24 L 60 15 L 68 24" /><text x="68" y="65">UP</text></svg>;
  }
  if (element.type === "RETURN_STAIRS") {
    return (
      <svg className="map-fixture-symbol map-return-stairs" viewBox="0 0 180 140" style={rotation} aria-label={element.label}>
        <path className="map-stair-outline" d="M 4 4 H 176 V 136 H 72 V 118 H 4 V 76 H 148 V 64 H 4 Z" />
        <path d="M 16 14 V 58 M 32 14 V 58 M 48 14 V 58 M 64 14 V 58 M 80 14 V 58 M 96 14 V 58 M 112 14 V 58 M 128 14 V 58 M 144 14 V 58 M 160 14 V 128 M 144 82 V 128 M 128 82 V 128 M 112 82 V 128 M 96 82 V 128 M 80 82 V 128" />
        <path className="map-stair-direction" d="M 28 36 H 142 M 132 28 L 142 36 L 132 44 M 142 104 H 86 M 96 96 L 86 104 L 96 112" />
        <path className="map-stair-break" d="M 82 12 L 92 60 M 88 12 L 98 60 M 118 80 L 108 130 M 124 80 L 114 130" />
        <text x="8" y="112">UP</text>
      </svg>
    );
  }
  if (element.type === "LIFT") {
    return <svg className="map-fixture-symbol" viewBox="0 0 100 100" aria-label={element.label}><rect x="3" y="3" width="94" height="94" /><path d="M 50 5 V 95 M 18 25 L 28 15 L 38 25 M 62 75 L 72 85 L 82 75" /><text x="50" y="58" textAnchor="middle">LIFT</text></svg>;
  }
  if (element.type === "TABLE") {
    return <svg className="map-fixture-symbol" viewBox="0 0 120 70" aria-label={element.label}><rect x="4" y="4" width="112" height="62" rx="9" /><circle cx="16" cy="16" r="3" /><circle cx="104" cy="16" r="3" /><circle cx="16" cy="54" r="3" /><circle cx="104" cy="54" r="3" /></svg>;
  }
  if (element.type === "CHAIR") {
    return <svg className="map-fixture-symbol" viewBox="0 0 60 60" aria-label={element.label}><rect x="12" y="17" width="36" height="34" rx="7" /><path d="M 10 10 H 50 V 21 M 16 50 V 57 M 44 50 V 57" /></svg>;
  }
  if (element.type === "CUPBOARD") {
    return <svg className="map-fixture-symbol" viewBox="0 0 110 50" aria-label={element.label}><rect x="2" y="2" width="106" height="46" /><path d="M 55 3 V 47" /><circle cx="49" cy="25" r="2" /><circle cx="61" cy="25" r="2" /></svg>;
  }
  return <span>{element.label}</span>;
}

function Tool({
  icon,
  label,
  type,
  action,
  draggable,
}: {
  icon: React.ReactNode;
  label: string;
  type?: ElementType;
  action?: () => void;
  draggable?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={action}
      draggable={draggable}
      onDragStart={(event) =>
        event.dataTransfer.setData(
          "application/map-tool",
          type || label.toUpperCase(),
        )
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function unitTypeSummary(type?: UnitType) {
  if (!type) return "";
  const area =
    type.areaSqMetres ||
    (type.widthMetres && type.lengthMetres
      ? String(Math.round(Number(type.widthMetres) * Number(type.lengthMetres)))
      : "");
  const dimensions = [type.widthMetres, type.lengthMetres]
    .filter(Boolean)
    .join(" × ");
  return `${area ? `${area} m²` : "Area not set"}${dimensions ? ` · ${dimensions} m` : ""}`;
}

function formatUnitArea(type?: UnitType) {
  if (!type) return "Area not set";
  const storedArea = Number(type.areaSqMetres);
  const calculatedArea =
    Number(type.widthMetres) * Number(type.lengthMetres);
  const area = storedArea > 0 ? storedArea : calculatedArea;
  if (!Number.isFinite(area) || area <= 0) return "Area not set";
  return `${Number(area.toFixed(2)).toLocaleString("en-ZA")} m²`;
}

function UnitPlacementDialog({
  facility,
  placedUnitIds,
  floorName,
  draftNumbers,
  close,
  place,
}: {
  facility: Facility;
  placedUnitIds: Set<string>;
  floorName: string;
  draftNumbers: string[];
  close: () => void;
  place: (unit: Unit | null, draft?: DraftUnit) => void;
}) {
  const nextUnitNumber = useMemo(() => {
    const numericNumbers = [...facility.units.map((unit) => unit.number), ...draftNumbers]
      .filter((number) => /^\d+$/.test(number.trim()))
      .map(Number);
    let candidate = numericNumbers.length ? Math.max(...numericNumbers) + 1 : 1;
    const used = new Set([
      ...facility.units.map((unit) => unit.number.toLowerCase()),
      ...draftNumbers.map((number) => number.toLowerCase()),
    ]);
    while (used.has(String(candidate).toLowerCase())) candidate += 1;
    return String(candidate);
  }, [facility.units, draftNumbers]);
  const [mode, setMode] = useState<"existing" | "new">(
    facility.units.some((unit) => !placedUnitIds.has(unit.id))
      ? "existing"
      : "new",
  );
  const availableUnits = facility.units.filter(
    (unit) => !placedUnitIds.has(unit.id),
  );
  const [error, setError] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState(
    facility.unitTypes[0]?.id || "",
  );
  const [selectedUnitId, setSelectedUnitId] = useState(
    availableUnits[0]?.id || "",
  );
  const selectedType =
    mode === "existing"
      ? availableUnits.find((unit) => unit.id === selectedUnitId)?.unitType
      : facility.unitTypes.find((type) => type.id === selectedTypeId);
  function submit(form: FormData) {
    if (mode === "existing") {
      const unit = availableUnits.find(
        (item) => item.id === form.get("unitId"),
      );
      if (unit) place(unit);
      return;
    }
    const number = String(form.get("number")).trim();
    if (
      facility.units.some(
        (unit) => unit.number.toLowerCase() === number.toLowerCase(),
      ) ||
      draftNumbers.some((item) => item.toLowerCase() === number.toLowerCase())
    ) {
      setError(
        `Unit number ${number} already exists or is already waiting to be saved.`,
      );
      return;
    }
    place(null, {
      unitTypeId: String(form.get("unitTypeId")),
      number,
      floor: floorName,
      zone: String(form.get("zone") || "") || undefined,
      monthlyRate: Number(form.get("monthlyRate")),
      taxRate: Number(form.get("taxRate") || 15) / 100,
    });
  }
  return (
    <div className="modal-backdrop">
      <div className="modal-card map-unit-modal">
        <button className="modal-close" onClick={close}>
          <X size={18} />
        </button>
        <p className="eyebrow">Map unit</p>
        <h2>Place a unit</h2>
        <div className="map-unit-tabs">
          <button
            className={mode === "existing" ? "active" : ""}
            onClick={() => {
              setMode("existing");
              setError("");
            }}
            disabled={!availableUnits.length}
          >
            Existing unit
          </button>
          <button
            className={mode === "new" ? "active" : ""}
            onClick={() => {
              setMode("new");
              setError("");
            }}
          >
            Create new unit
          </button>
        </div>
        <form action={submit} className="inventory-form">
          {mode === "existing" ? (
            <label className="inventory-form-wide">
              Available unit
              <select
                name="unitId"
                value={selectedUnitId}
                onChange={(event) => setSelectedUnitId(event.target.value)}
                required
              >
                {availableUnits.map((unit) => (
                  <option value={unit.id} key={unit.id}>
                    {unit.number} · {unit.unitType.name} ·{" "}
                    {unitTypeSummary(unit.unitType)} · {unit.status}
                  </option>
                ))}
              </select>
            </label>
          ) : facility.unitTypes.length ? (
            <>
              <label>
                Unit type
                <select
                  name="unitTypeId"
                  value={selectedTypeId}
                  onChange={(event) => setSelectedTypeId(event.target.value)}
                  required
                >
                  {facility.unitTypes.map((type) => (
                    <option value={type.id} key={type.id}>
                      {type.name} · {unitTypeSummary(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Unit number
                <input name="number" defaultValue={nextUnitNumber} required />
              </label>
              <label>
                Zone / section
                <input name="zone" />
              </label>
              <label>
                Monthly rate (R)
                <input
                  name="monthlyRate"
                  type="number"
                  min="0"
                  step=".01"
                  required
                />
              </label>
              <label>
                VAT rate (%)
                <input
                  name="taxRate"
                  type="number"
                  defaultValue="15"
                  step=".01"
                />
              </label>
            </>
          ) : (
            <p className="form-error inventory-form-wide">
              Create at least one unit type before placing units.{" "}
              <Link href="/units">Open Units &amp; Availability</Link>.
            </p>
          )}
          {selectedType ? (
            <div className="map-unit-size-summary inventory-form-wide">
              <span>Selected size</span>
              <strong>{unitTypeSummary(selectedType)}</strong>
            </div>
          ) : null}
          {error ? (
            <p className="form-error inventory-form-wide">{error}</p>
          ) : null}
          <div className="form-actions inventory-form-wide">
            <button
              type="button"
              className="button button-secondary"
              onClick={close}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={mode === "new" && !facility.unitTypes.length}
            >
              Place unit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

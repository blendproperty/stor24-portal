"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ListOrdered,
  Pencil,
  Plus,
  BadgeDollarSign,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type UnitType = {
  id: string;
  facilityId: string;
  name: string;
  widthMetres: string | null;
  lengthMetres: string | null;
  areaSqMetres: string | null;
  features: string[];
};
type Unit = {
  id: string;
  facilityId: string;
  unitTypeId: string;
  number: string;
  floor: string | null;
  zone: string | null;
  status: string;
  monthlyRate: string;
  taxRate: string;
  accountId: string | null;
  unitType: UnitType;
};
type Facility = {
  id: string;
  name: string;
  code: string;
  unitTypes: UnitType[];
  units: Unit[];
};
type DialogState =
  { kind: "unit"; unit?: Unit } | { kind: "type"; unitType?: UnitType };
type RenumberChange = {
  unitId: string;
  oldNumber: string;
  newNumber: string;
};
type UatResetPreview = {
  customers: number;
  leads: number;
  reservations: number;
  paymentSessions: number;
  tenancies: number;
  occupancies: number;
  documents: number;
  accounts: number;
  payments: number;
  ledgerEntries: number;
  biometricEnrollments: number;
  customerTasksDetached: number;
  communicationsAnonymised: number;
  unitsReleased: number;
};

const editableStatuses = ["AVAILABLE", "SERVICE", "UNAVAILABLE"];
const statusLabel = (status: string) =>
  status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
const money = (value: string) =>
  Number(value).toLocaleString("en-ZA", { style: "currency", currency: "ZAR" });

export function UnitInventoryWorkspace({
  initialFacilities,
}: {
  initialFacilities: Facility[];
}) {
  const [facilities, setFacilities] = useState(initialFacilities);
  const [facilityId, setFacilityId] = useState(initialFacilities[0]?.id ?? "");
  const [typeId, setTypeId] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [display, setDisplay] = useState<"size" | "area">("area");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [forceDeleteCount, setForceDeleteCount] = useState(0);
  const [renumberDialog, setRenumberDialog] = useState(false);
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [uatResetPreview, setUatResetPreview] = useState<UatResetPreview | null>(null);
  const [uatResetConfirmation, setUatResetConfirmation] = useState("");
  const selectedFacility = facilities.find(
    (facility) => facility.id === facilityId,
  );
  const allUnits = facilities.flatMap((facility) =>
    facility.units.map((unit) => ({ ...unit, facility })),
  );
  const visible = allUnits.filter(
    (unit) =>
      (!facilityId || unit.facilityId === facilityId) &&
      (!typeId || unit.unitTypeId === typeId) &&
      (!status || unit.status === status) &&
      (!query ||
        `${unit.number} ${unit.unitType.name} ${unit.floor ?? ""} ${unit.zone ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const summaries = [
    ["Total units", allUnits.length],
    [
      "Available",
      allUnits.filter((unit) => unit.status === "AVAILABLE").length,
    ],
    ["Reserved", allUnits.filter((unit) => unit.status === "RESERVED").length],
    ["Occupied", allUnits.filter((unit) => unit.status === "OCCUPIED").length],
  ];
  const grouped = useMemo(
    () =>
      selectedFacility?.unitTypes.map((type) => ({
        type,
        assigned: selectedFacility.units.filter(
          (unit) => unit.unitTypeId === type.id,
        ).length,
        available: selectedFacility.units.filter(
          (unit) => unit.unitTypeId === type.id && unit.status === "AVAILABLE",
        ).length,
      })) ?? [],
    [selectedFacility],
  );

  async function applyMidrandMarketRates() {
    if (!selectedFacility || !window.confirm(`Apply the August 2026 Midrand market rate curve to all ${selectedFacility.units.length} standard unit rates at ${selectedFacility.name}? Existing tenancy rents and reservation quotes will not change.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/v1/leasing/unit-rates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ facilityId: selectedFacility.id, modelVersion: "MIDRAND_2026_08_V1" }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(result.error?.message ?? "The market rates could not be applied.");
      return;
    }
    await refresh();
    setNotice(`${result.data.updated} unit rates updated. Range ${money(String(result.data.minimumRate))} to ${money(String(result.data.maximumRate))}.`);
  }

  async function releaseOrphanedReservations(unit?: Unit) {
    if (!selectedFacility) return;
    if (!unit && !confirmingRelease) {
      setConfirmingRelease(true);
      setNotice("Review complete: click Confirm safe release to clean only cancelled test holds. Genuine customer records remain protected.");
      return;
    }
    if (unit && !window.confirm(`Check unit ${unit.number} and release it only when no active reservation and no protected occupancy remains?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/v1/leasing/units/release-orphans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ facilityId: selectedFacility.id, unitId: unit?.id }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    setConfirmingRelease(false);
    if (!response.ok) {
      setError(result.error?.message ?? "The reserved-unit check could not be completed.");
      return;
    }
    await refresh();
    const released = result.data.released as string[];
    const blocked = result.data.blocked as Array<{ unit: string; reasons: string[] }>;
    if (unit && released.length) setDialog(null);
    setNotice(released.length
      ? `${released.length} orphaned reserved unit${released.length === 1 ? "" : "s"} released: ${released.join(", ")}.${blocked.length ? ` ${blocked.length} protected by active records.` : ""}`
      : blocked.length
        ? `Nothing released. ${blocked.map((item) => `Unit ${item.unit}: ${item.reasons.join(" and ")}`).join("; ")}.`
        : "No orphaned reserved units were found.");
  }

  async function uatReset(action: "preview" | "reset") {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/v1/admin/uat-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "preview"
        ? { action }
        : { action, confirmation: uatResetConfirmation }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(result.error?.message ?? "The UAT reset could not be completed.");
      return;
    }
    if (action === "preview") {
      setUatResetPreview(result.data);
      setNotice("Reset preview ready. Review the counts below before confirming.");
      return;
    }
    setUatResetPreview(null);
    setUatResetConfirmation("");
    await refresh();
    setNotice(`${result.data.customers} test customer${result.data.customers === 1 ? "" : "s"} removed and ${result.data.unitsReleased} unit${result.data.unitsReleased === 1 ? "" : "s"} released. Inventory, rates and configuration were preserved.`);
  }

  async function refresh() {
    const accountByUnitId = new Map(
      facilities.flatMap((facility) => facility.units.map((unit) => [unit.id, unit.accountId] as const)),
    );
    const [facilityResponse, typeResponse, unitResponse] = await Promise.all([
      fetch("/api/v1/leasing/facilities", { cache: "no-store" }),
      fetch("/api/v1/leasing/unit-types", { cache: "no-store" }),
      fetch("/api/v1/leasing/units", { cache: "no-store" }),
    ]);
    const [facilityPayload, typePayload, unitPayload] = await Promise.all([
      facilityResponse.json(),
      typeResponse.json(),
      unitResponse.json(),
    ]);
    if (!facilityResponse.ok || !typeResponse.ok || !unitResponse.ok)
      throw new Error("Inventory could not be refreshed.");
    setFacilities(
      facilityPayload.data.map((facility: Facility) => ({
        ...facility,
        unitTypes: typePayload.data.filter(
          (type: UnitType) => type.facilityId === facility.id,
        ),
        units: unitPayload.data.filter(
          (unit: Unit) => unit.facilityId === facility.id,
        ).map((unit: Unit) => ({ ...unit, accountId: accountByUnitId.get(unit.id) ?? null })),
      })),
    );
  }

  async function submit(form: FormData) {
    if (!dialog) return;
    const isType = dialog.kind === "type";
    const editing = isType ? dialog.unitType : dialog.unit;
    const targetFacility = String(form.get("facilityId") ?? facilityId);
    const width = Number(form.get("widthMetres") || 0);
    const length = Number(form.get("lengthMetres") || 0);
    const area = Number(form.get("areaSqMetres") || 0);
    const payload = isType
      ? {
          facilityId: targetFacility,
          name: form.get("name"),
          widthMetres: width || undefined,
          lengthMetres: length || undefined,
          areaSqMetres: area || undefined,
          features: String(form.get("features") ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }
      : {
          facilityId: targetFacility,
          unitTypeId: form.get("unitTypeId"),
          number: form.get("number"),
          floor: form.get("floor") || undefined,
          zone: form.get("zone") || undefined,
          monthlyRate: form.get("monthlyRate"),
          taxRate: Number(form.get("taxRate") || 15) / 100,
          status: editing ? form.get("status") : "AVAILABLE",
        };
    setBusy(true);
    setError("");
    setNotice("");
    const resource = isType ? "unit-types" : "units";
    const response = await fetch(`/api/v1/leasing/${resource}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        editing ? { id: editing.id, data: payload } : payload,
      ),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(
        result.error?.message ??
          (response.status === 409
            ? "This change conflicts with an existing inventory record."
            : "The inventory record could not be saved."),
      );
      return;
    }
    await refresh();
    setDialog(null);
    setNotice(
      isType
        ? editing
          ? "Unit type updated."
          : "Unit type added."
        : editing
          ? "Unit updated."
          : "Unit added.",
    );
  }

  async function deleteUnitType(unitType: UnitType, confirmed = false, force = false) {
    if (!confirmed && !window.confirm(`Delete the ${unitType.name} unit type?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch(
      `/api/v1/leasing/unit-types?id=${encodeURIComponent(unitType.id)}${force ? "&force=true" : ""}`,
      { method: "DELETE" },
    );
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setForceDeleteCount(result.error?.canForceDelete ? Number(result.error.assigned || 0) : 0);
      setError(
        result.error?.message ?? "The unit type could not be deleted.",
      );
      if (result.error?.canForceDelete) setDialog({ kind: "type", unitType });
      return;
    }
    setForceDeleteCount(0);
    if (typeId === unitType.id) setTypeId("");
    await refresh();
    setDialog(null);
    setNotice("Unit type deleted.");
  }

  async function deleteUnit(unit: Unit) {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch(
      `/api/v1/leasing/units?id=${encodeURIComponent(unit.id)}&force=true`,
      { method: "DELETE" },
    );
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(result.error?.message ?? "The unit could not be permanently deleted.");
      return;
    }
    await refresh();
    setDialog(null);
    setNotice(`Unit ${unit.number} permanently deleted.`);
  }

  return (
    <div className="page-stack unit-inventory-workspace">
      <PageHeader
        eyebrow="Inventory"
        title="Units & availability"
        description="Store-scoped unit register, physical attributes, availability and operational rates."
        action={
          <div className="form-actions">
            <button
              className="button button-danger"
              onClick={() => void uatReset("preview")}
              disabled={busy}
            >
              <Trash2 size={15} />
              Reset UAT customers
            </button>
            <button
              className={`button ${confirmingRelease ? "button-primary" : "button-secondary"}`}
              onClick={() => void releaseOrphanedReservations()}
              disabled={!selectedFacility?.units.some((unit) => unit.status === "RESERVED") || busy}
            >
              <ShieldCheck size={15} />
              {confirmingRelease ? "Confirm safe release" : "Release cancelled holds"}
            </button>
            <button
              className="button button-secondary"
              onClick={() => void applyMidrandMarketRates()}
              disabled={!selectedFacility?.units.length || busy}
            >
              <BadgeDollarSign size={15} />
              Apply Midrand rates
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                setRenumberDialog(true);
                setError("");
              }}
              disabled={!selectedFacility?.units.length}
            >
              <ListOrdered size={15} />
              Renumber units
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                setDialog({ kind: "type" });
                setError("");
              }}
            >
              <Plus size={15} />
              Unit type
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setDialog({ kind: "unit" });
                setError("");
              }}
              disabled={
                !facilities.some((facility) => facility.unitTypes.length)
              }
            >
              <Plus size={15} />
              Add unit
            </button>
          </div>
        }
      />
    {notice ? <p className="form-success">{notice}</p> : null}
    {error && !dialog ? <p className="form-error">{error}</p> : null}
      {uatResetPreview ? (
        <section className="panel uat-reset-preview" aria-label="UAT reset preview">
          <div>
            <p className="eyebrow">Destructive UAT reset preview</p>
            <h2>{uatResetPreview.customers} test customers will be removed</h2>
            <p>
              This will remove {uatResetPreview.reservations} reservations, {uatResetPreview.tenancies} draft or test tenancies,
              {" "}{uatResetPreview.occupancies} occupancy records, {uatResetPreview.documents} lease records and {uatResetPreview.paymentSessions} simulated payment sessions.
              {" "}{uatResetPreview.unitsReleased} linked units will return to Available.
            </p>
            <p>Facilities, units, unit types, rates, maps, integrations, templates and audit events will remain.</p>
          </div>
          <label>
            Type <strong>RESET TEST CUSTOMERS</strong> to confirm
            <input
              value={uatResetConfirmation}
              onChange={(event) => setUatResetConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="form-actions">
            <button type="button" className="button button-secondary" onClick={() => { setUatResetPreview(null); setUatResetConfirmation(""); }}>
              Keep the test data
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={busy || uatResetConfirmation !== "RESET TEST CUSTOMERS"}
              onClick={() => void uatReset("reset")}
            >
              <Trash2 size={15} /> Delete test customers and release units
            </button>
          </div>
        </section>
      ) : null}
      <section className="summary-strip">
        {summaries.map(([label, count]) => (
          <div className="summary-cell" key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </section>
      <section className="panel inventory-toolbar">
        <label>
          Store
          <select
            value={facilityId}
            onChange={(event) => {
              setFacilityId(event.target.value);
              setTypeId("");
            }}
          >
            <option value="">All permitted stores</option>
            {facilities.map((facility) => (
              <option value={facility.id} key={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Unit type
          <select
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
          >
            <option value="">All types</option>
            {(
              selectedFacility?.unitTypes ??
              facilities.flatMap((facility) => facility.unitTypes)
            ).map((type) => (
              <option value={type.id} key={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {[
              "AVAILABLE",
              "HELD",
              "RESERVED",
              "OCCUPIED",
              "SERVICE",
              "UNAVAILABLE",
            ].map((item) => (
              <option value={item} key={item}>
                {statusLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="inventory-search">
          <span>Find unit</span>
          <span className="toolbar-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Number, type, floor or zone"
            />
          </span>
        </label>
        <fieldset>
          <legend>Display</legend>
          <label>
            <input
              type="radio"
              checked={display === "size"}
              onChange={() => setDisplay("size")}
            />
            Nominal dimensions
          </label>
          <label>
            <input
              type="radio"
              checked={display === "area"}
              onChange={() => setDisplay("area")}
            />
            Area
          </label>
        </fieldset>
      </section>
      <section className="inventory-layout">
        <div className="panel">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Unit</th>
                  <th>Type</th>
                  <th>{display === "size" ? "Nominal dimensions" : "Area"}</th>
                  <th>Floor / zone</th>
                  <th>Status</th>
                  <th>Monthly rate</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((unit) => (
                    <tr key={unit.id}>
                      <td>{unit.facility.name}</td>
                      <td className="primary-cell">{unit.accountId ? <Link className="inventory-unit-link" href={`/operations/accounts?accountId=${encodeURIComponent(unit.accountId)}`}>{unit.number}<span>Open account</span></Link> : unit.number}</td>
                      <td>{unit.unitType.name}</td>
                      <td>
                        {display === "size"
                          ? [
                              unit.unitType.widthMetres,
                              unit.unitType.lengthMetres,
                            ].filter(Boolean).length
                            ? `${[
                                unit.unitType.widthMetres,
                                unit.unitType.lengthMetres,
                              ]
                                .filter(Boolean)
                                .join(" × ")} m`
                            : "—"
                          : unit.unitType.areaSqMetres
                            ? `${unit.unitType.areaSqMetres} m²`
                            : "—"}
                      </td>
                      <td>
                        {[unit.floor, unit.zone].filter(Boolean).join(" / ") ||
                          "—"}
                      </td>
                      <td>
                        <StatusPill
                          tone={
                            unit.status === "AVAILABLE"
                              ? "positive"
                              : unit.status === "SERVICE" ||
                                  unit.status === "UNAVAILABLE"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {statusLabel(unit.status)}
                        </StatusPill>
                      </td>
                      <td>{money(unit.monthlyRate)}</td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Edit unit ${unit.number}`}
                          onClick={() => {
                            setDialog({ kind: "unit", unit });
                            setError("");
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty-cell" colSpan={8}>
                      No units match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="panel inventory-breakdown">
          <h2>
            <Warehouse size={18} />
            Availability
          </h2>
          {grouped.length ? (
            grouped.map(({ type, available, assigned }) => (
              <div className="inventory-type-row" key={type.id}>
                <button type="button" onClick={() => setTypeId(type.id)}>
                  <span>
                    <strong>{type.name}</strong>
                    <small>
                      {type.areaSqMetres
                        ? `${type.areaSqMetres} m²`
                        : [type.widthMetres, type.lengthMetres]
                            .filter(Boolean)
                            .join(" × ")}
                    </small>
                    <small>{assigned} unit{assigned === 1 ? "" : "s"} assigned</small>
                  </span>
                  <b>{available}</b>
                </button>
                <div className="inventory-type-actions">
                  <button type="button" className="text-button" onClick={() => { setDialog({ kind: "type", unitType: type }); setError(""); }}><Pencil size={14}/>Edit</button>
                  <button type="button" className="text-button danger" disabled={busy} title={assigned > 0 ? `${assigned} unit${assigned === 1 ? " is" : "s are"} assigned to this type. Reassign those units before deleting it.` : `Delete ${type.name}`} onClick={() => void deleteUnitType(type)}><Trash2 size={14}/>Delete</button>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-cell">Add a unit type to begin.</p>
          )}
        </aside>
      </section>
      {dialog ? (
        <InventoryDialog
          state={dialog}
          facilities={facilities}
          defaultFacilityId={facilityId || facilities[0]?.id || ""}
          busy={busy}
          error={error}
          close={() => setDialog(null)}
          submit={submit}
          deleteUnitType={deleteUnitType}
          deleteUnit={deleteUnit}
          releaseOrphanedReservations={releaseOrphanedReservations}
          forceDeleteCount={forceDeleteCount}
        />
      ) : null}
      {renumberDialog && selectedFacility ? (
        <RenumberUnitsDialog
          facility={selectedFacility}
          close={() => setRenumberDialog(false)}
          applied={async (message) => {
            await refresh();
            setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}

function RenumberUnitsDialog({
  facility,
  close,
  applied,
}: {
  facility: Facility;
  close: () => void;
  applied: (message: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    changes: RenumberChange[];
    mappedCount: number;
  } | null>(null);
  const [undoChanges, setUndoChanges] = useState<
    Array<{ unitId: string; newNumber: string }> | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const sortedUnits = useMemo(
    () =>
      [...facility.units].sort((left, right) =>
        left.number.localeCompare(right.number, "en-ZA", {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    [facility.units],
  );
  const visibleUnits = sortedUnits.filter((unit) =>
    `${unit.number} ${unit.floor ?? ""} ${unit.zone ?? ""} ${unit.unitType.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const proposedChanges = sortedUnits.flatMap((unit) => {
    const newNumber = draft[unit.id]?.trim();
    return newNumber && newNumber !== unit.number
      ? [{ unitId: unit.id, newNumber }]
      : [];
  });

  async function send(
    action: "preview" | "apply",
    changes = proposedChanges,
  ) {
    setBusy(true);
    setError("");
    setSuccess("");
    const response = await fetch("/api/v1/leasing/units/renumber", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ facilityId: facility.id, action, changes }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(payload.error?.message ?? "The unit numbers could not be checked.");
      return;
    }
    if (action === "preview") {
      setPreview(payload.data);
      return;
    }
    const count = Number(payload.data.changes.length);
    const mapCount = Number(payload.data.syncedMapLabels);
    setUndoChanges(payload.data.undoChanges);
    setDraft({});
    setPreview(null);
    setSuccess(
      `${count} unit${count === 1 ? "" : "s"} renumbered. ${mapCount} map label${mapCount === 1 ? "" : "s"} synchronised.`,
    );
    await applied(
      `${count} unit${count === 1 ? "" : "s"} renumbered without changing the saved map layout.`,
    );
  }

  async function undo() {
    if (!undoChanges?.length) return;
    await send("apply", undoChanges);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card renumber-modal" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={close}>
          <X size={18} />
        </button>
        <p className="eyebrow">Unit inventory</p>
        <h2>Renumber units</h2>
        <p className="modal-copy">
          Change numbers for {facility.name}. Swaps are supported. Unit records,
          reservations and map positions remain linked by their permanent IDs.
        </p>
        <p className="safe-config-note">
          <ShieldCheck size={17} /> Nothing is saved until the preview passes all
          duplicate and collision checks.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        {success ? <p className="form-success">{success}</p> : null}
        <label className="renumber-search">
          Find a unit
          <span className="toolbar-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Number, floor, zone or type"
            />
          </span>
        </label>
        <div className="renumber-list" role="table" aria-label="Unit renumbering">
          <div className="renumber-row renumber-heading" role="row">
            <strong>Current</strong>
            <strong>New number</strong>
            <strong>Floor / type</strong>
          </div>
          {visibleUnits.map((unit) => (
            <div className="renumber-row" role="row" key={unit.id}>
              <strong>{unit.number}</strong>
              <input
                aria-label={`New number for unit ${unit.number}`}
                value={draft[unit.id] ?? ""}
                placeholder={unit.number}
                maxLength={40}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    [unit.id]: event.target.value,
                  }));
                  setPreview(null);
                  setUndoChanges(null);
                  setSuccess("");
                }}
              />
              <span>
                {[unit.floor, unit.zone].filter(Boolean).join(" / ") || "—"}
                <small>{unit.unitType.name}</small>
              </span>
            </div>
          ))}
        </div>
        {preview ? (
          <div className="renumber-preview">
            <strong>
              Preview: {preview.changes.length} unit
              {preview.changes.length === 1 ? "" : "s"}
            </strong>
            <span>{preview.mappedCount} visible map labels will update.</span>
            <div>
              {preview.changes.map((change) => (
                <span key={change.unitId}>
                  {change.oldNumber} → {change.newNumber}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="form-actions">
          {undoChanges?.length ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={undo}
              disabled={busy}
            >
              <RotateCcw size={15} /> Undo last renumbering
            </button>
          ) : null}
          <button type="button" className="button button-secondary" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => send("preview")}
            disabled={busy || !proposedChanges.length}
          >
            Preview changes
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => send("apply")}
            disabled={busy || !preview}
          >
            {busy ? "Saving…" : "Apply renumbering"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InventoryDialog({
  state,
  facilities,
  defaultFacilityId,
  busy,
  error,
  close,
  submit,
  deleteUnitType,
  deleteUnit,
  releaseOrphanedReservations,
  forceDeleteCount,
}: {
  state: DialogState;
  facilities: Facility[];
  defaultFacilityId: string;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (form: FormData) => void;
  deleteUnitType: (unitType: UnitType, confirmed?: boolean, force?: boolean) => void;
  deleteUnit: (unit: Unit) => void;
  releaseOrphanedReservations: (unit?: Unit) => Promise<void>;
  forceDeleteCount: number;
}) {
  const isType = state.kind === "type";
  const editingUnit = state.kind === "unit" ? state.unit : undefined;
  const editingType = state.kind === "type" ? state.unitType : undefined;
  const [facilityId, setFacilityId] = useState(
    editingUnit?.facilityId ?? editingType?.facilityId ?? defaultFacilityId,
  );
  const [typeWidth, setTypeWidth] = useState(editingType?.widthMetres ?? "");
  const [typeLength, setTypeLength] = useState(editingType?.lengthMetres ?? "");
  const [typeArea, setTypeArea] = useState(editingType?.areaSqMetres ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const calculatedArea =
    Number(typeWidth) > 0 && Number(typeLength) > 0
      ? String(Math.round(Number(typeWidth) * Number(typeLength)))
      : "";
  const types =
    facilities.find((facility) => facility.id === facilityId)?.unitTypes ?? [];
  return (
    <div className="modal-backdrop">
      <div
        className="modal-card inventory-modal"
        role="dialog"
        aria-modal="true"
      >
        <button className="modal-close" onClick={close}>
          <X size={18} />
        </button>
        <p className="eyebrow">Unit inventory</p>
        <h2>
          {isType
            ? editingType
              ? `Edit ${editingType.name}`
              : "Add unit type"
            : editingUnit
              ? `Edit unit ${editingUnit.number}`
              : "Add unit"}
        </h2>
        {error ? <p className="form-error inventory-dialog-error">{error}</p> : null}
        <form action={submit} className="inventory-form">
          <label>
            Store
            <select
              name="facilityId"
              value={facilityId}
              onChange={(event) => setFacilityId(event.target.value)}
              disabled={Boolean(editingUnit || editingType)}
            >
              {facilities.map((facility) => (
                <option value={facility.id} key={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </label>
          {isType ? (
            <>
              <Field
                name="name"
                label="Type name"
                value={editingType?.name}
                required
              />
              <label>
                Width (metres)
                <input
                  name="widthMetres"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={typeWidth}
                  onChange={(event) => setTypeWidth(event.target.value)}
                />
              </label>
              <label>
                Length (metres)
                <input
                  name="lengthMetres"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={typeLength}
                  onChange={(event) => setTypeLength(event.target.value)}
                />
              </label>
              <label className="inventory-calculated-field">
                Area (m²)
                <input
                  name="areaSqMetres"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={typeArea}
                  onChange={(event) => setTypeArea(event.target.value)}
                  required
                />
                <small>
                  This is the authoritative rentable area shown on the map and in reservations.
                  Width and length only set the default shape when placing a new unit.
                </small>
                {calculatedArea && calculatedArea !== typeArea ? (
                  <small>
                    Nominal dimensions calculate approximately {calculatedArea} m²;
                    they will not replace the authoritative area.
                  </small>
                ) : null}
              </label>
              <Field
                name="features"
                label="Features (comma separated)"
                className="inventory-form-wide"
                placeholder="Inside, climate controlled, power"
                value={editingType?.features.join(", ")}
              />
            </>
          ) : (
            <>
              <label>
                Unit type
                <select
                  name="unitTypeId"
                  defaultValue={editingUnit?.unitTypeId}
                  required
                >
                  {types.map((type) => (
                    <option value={type.id} key={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                name="number"
                label="Unit number"
                value={editingUnit?.number}
                required
              />
              <Field name="floor" label="Floor" value={editingUnit?.floor} />
              <Field
                name="zone"
                label="Zone / section"
                value={editingUnit?.zone}
              />
              <Field
                name="monthlyRate"
                label="Monthly rate (R)"
                value={editingUnit?.monthlyRate}
                type="number"
                step=".01"
                required
              />
              <Field
                name="taxRate"
                label="VAT rate (%)"
                value={
                  editingUnit ? String(Number(editingUnit.taxRate) * 100) : "15"
                }
                type="number"
                step=".01"
              />
              {editingUnit ? (
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={
                      editableStatuses.includes(editingUnit.status)
                        ? editingUnit.status
                        : editingUnit.status
                    }
                    disabled={!editableStatuses.includes(editingUnit.status)}
                  >
                    {editableStatuses.includes(editingUnit.status) ? (
                      editableStatuses.map((item) => (
                        <option value={item} key={item}>
                          {statusLabel(item)}
                        </option>
                      ))
                    ) : (
                      <option value={editingUnit.status}>
                        {statusLabel(editingUnit.status)} — managed by tenancy
                      </option>
                    )}
                  </select>
                </label>
              ) : null}
              {editingUnit?.status === "RESERVED" ? (
                <div className="inventory-form-wide managed-status-recovery">
                  <p>This status is protected from manual editing. Use the guarded check to release it only when no active reservation or occupancy remains.</p>
                  <button type="button" className="button button-secondary" disabled={busy} onClick={() => void releaseOrphanedReservations(editingUnit)}>
                    <ShieldCheck size={15} /> Check and release cancelled hold
                  </button>
                </div>
              ) : null}
            </>
          )}
          <div className="form-actions inventory-form-wide">
            {editingType ? (
              <button
                type="button"
                className="button button-danger"
                onClick={() => confirmingDelete ? deleteUnitType(editingType, true) : setConfirmingDelete(true)}
                disabled={busy}
              >
                <Trash2 size={15} /> {confirmingDelete ? `Confirm delete ${editingType.name}` : "Delete type"}
              </button>
            ) : null}
            {editingType && forceDeleteCount > 0 ? (
              <button
                type="button"
                className="button button-danger"
                onClick={() => deleteUnitType(editingType, true, true)}
                disabled={busy}
              >
                <Trash2 size={15} /> Delete type and {forceDeleteCount} unused unit{forceDeleteCount === 1 ? "" : "s"}
              </button>
            ) : null}
            {editingUnit ? (
              <button
                type="button"
                className="button button-danger"
                onClick={() => confirmingDelete ? deleteUnit(editingUnit) : setConfirmingDelete(true)}
                disabled={busy}
              >
                <Trash2 size={15} /> {confirmingDelete ? `Confirm permanent deletion of unit ${editingUnit.number}` : "Delete unit permanently"}
              </button>
            ) : null}
            <button
              type="button"
              className="button button-secondary"
              onClick={close}
            >
              Cancel
            </button>
            <button className="button button-primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  className,
  ...props
}: Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue"
> & { label: string; value?: string | null }) {
  return (
    <label className={className}>
      {label}
      <input defaultValue={value ?? ""} {...props} />
    </label>
  );
}

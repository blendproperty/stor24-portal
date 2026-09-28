"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { CalendarCheck, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

type Unit = {
  id: string;
  facilityId: string;
  number: string;
  monthlyRate: string;
  unitType: { name: string; areaSqMetres: string | null };
};
type Facility = { id: string; name: string; units: Unit[] };
type Customer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
};
type Reservation = {
  id: string;
  status: string;
  quotedRate: string;
  holdExpiresAt: string | null;
  intendedMoveIn: string | null;
  createdAt: string;
  facility: { id: string; name: string };
  customer: Customer;
  unit: Unit;
  lead: { id: string } | null;
  convertedTenancy: { id: string } | null;
};
type Payload = {
  facilities: Facility[];
  customers: Customer[];
  reservations: Reservation[];
};
const customerName = (customer: Customer) =>
  customer.companyName ||
  [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
  "Unnamed customer";
const formatDate = (date: string | null) => formatSouthAfricaDateTime(date);
const money = z.string().min(1).refine(value => Number.isFinite(Number(value)));
const date = z.string().datetime({ offset: true });
const customerSchema = z.object({ id: z.string().min(1), firstName: z.string().nullable(), lastName: z.string().nullable(), companyName: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable() });
const unitSchema = z.object({ id: z.string().min(1), facilityId: z.string().min(1), number: z.string(), monthlyRate: money, unitType: z.object({ name: z.string(), areaSqMetres: money.nullable() }) });
const reservationReadSchema = z.object({ data: z.object({
  facilities: z.array(z.object({ id: z.string().min(1), name: z.string(), units: z.array(unitSchema) })),
  customers: z.array(customerSchema),
  reservations: z.array(z.object({ id: z.string().min(1), status: z.enum(["ACTIVE", "CONVERTED", "CANCELLED", "EXPIRED"]), quotedRate: money, holdExpiresAt: date.nullable(), intendedMoveIn: date.nullable(), createdAt: date, facility: z.object({ id: z.string().min(1), name: z.string() }), customer: customerSchema, unit: unitSchema, lead: z.object({ id: z.string() }).nullable(), convertedTenancy: z.object({ id: z.string() }).nullable() })),
}) });
const emptyData: Payload = { facilities: [], customers: [], reservations: [] };

export function ReservationsWorkspace() {
  const [data, setData] = useState<Payload>({
    facilities: [],
    customers: [],
    reservations: [],
  });
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createBlocked, setCreateBlocked] = useState(false);
  const createRequest = useRef<AbortController | null>(null);
  const uncertainCreate = "We could not confirm whether the reservation was created. Review reservations before trying again. After checking the unit, reload this page to start another save.";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [readBusy, setReadBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const readRequest = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    readRequest.current?.abort();
    const controller = new AbortController(); readRequest.current = controller;
    setReadBusy(true); setLoaded(false); setReadError(""); setSignedOut(false); setData(emptyData); setDialog(false);
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/v1/reservations", { cache: "no-store", signal: controller.signal });
      if (readRequest.current !== controller) return;
      if (response.status === 401 || response.status === 403) {
        setSignedOut(response.status === 401);
        setReadError(response.status === 401 ? "Your session has ended. Sign in again to view reservations." : "Reservation access is unavailable. Please contact your administrator if you require access.");
        setError(""); setNotice(""); setFacilityId(""); setQuery(""); return;
      }
      if (!response.ok) throw new Error("RESERVATIONS_READ_FAILED");
      const payload = reservationReadSchema.parse(await response.json());
      if (readRequest.current !== controller) return;
      if (controller.signal.aborted) throw new Error("RESERVATIONS_READ_TIMEOUT");
      setData(payload.data); setLoaded(true);
      setFacilityId(current => payload.data.facilities.some(f => f.id === current) ? current : payload.data.facilities[0]?.id ?? "");
    } catch {
      if (readRequest.current === controller) setReadError("Reservations could not be loaded. Refresh to try again.");
    } finally {
      clearTimeout(timer);
      if (readRequest.current === controller) { readRequest.current = null; setReadBusy(false); }
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); readRequest.current?.abort(); readRequest.current = null; };
  }, [load]);
  const [now] = useState(() => Date.now());
  const expiring = data.reservations.filter(
    (item) =>
      item.status === "ACTIVE" &&
      item.holdExpiresAt &&
      new Date(item.holdExpiresAt).getTime() <= now + 3 * 86400000,
  ).length;
  const visible = useMemo(
    () =>
      data.reservations.filter(
        (item) =>
          (!facilityId || item.facility.id === facilityId) &&
          (!status || item.status === status) &&
          (!query ||
            `${customerName(item.customer)} ${item.unit.number} ${item.unit.unitType.name}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [data.reservations, facilityId, status, query],
  );
  async function create(form: FormData) {
    if (createRequest.current || createBlocked || !loaded || readBusy) return;
    const input = {
      facilityId: String(form.get("facilityId") ?? ""), customerId: String(form.get("customerId") ?? ""), unitId: String(form.get("unitId") ?? ""), quotedRate: String(form.get("quotedRate") ?? ""),
      holdExpiresAt: String(form.get("holdExpiresAt") ?? "") || undefined, intendedMoveIn: String(form.get("intendedMoveIn") ?? "") || undefined,
    };
    const controller = new AbortController(); createRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/reservations", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      if (response.status === 401 || response.status === 403) {
        setDialog(false); setData(emptyData); setLoaded(false); setFacilityId(""); setQuery(""); setSignedOut(response.status === 401);
        setReadError(response.status === 401 ? "Your session has ended. Sign in again to create reservations." : "Reservation access is unavailable. Please contact your administrator if you require access."); return;
      }
      if ([400, 404, 409, 422].includes(response.status)) {
        setError(response.status === 409 ? "That unit is no longer available. Refresh and choose another unit." : "Check the reservation details and try again."); return;
      }
      if (!response.ok) throw new Error("RESERVATION_SAVE_UNCERTAIN");
      const confirmation = z.object({ data: z.object({
        id: z.string().min(1), status: z.literal("ACTIVE"), facilityId: z.literal(input.facilityId), customerId: z.literal(input.customerId), unitId: z.literal(input.unitId),
        quotedRate: money.refine(value => Number(value) === Number(input.quotedRate)),
        holdExpiresAt: input.holdExpiresAt ? z.literal(new Date(input.holdExpiresAt).toISOString()) : z.null(),
        intendedMoveIn: input.intendedMoveIn ? z.literal(new Date(input.intendedMoveIn).toISOString()) : z.null(),
      }) });
      confirmation.parse(await response.json());
      if (controller.signal.aborted) throw new Error("RESERVATION_SAVE_TIMEOUT");
      setDialog(false); setNotice("Reservation created and the unit is now held.");
      await load();
    } catch {
      setCreateBlocked(true); setError(uncertainCreate);
    } finally {
      clearTimeout(timer); createRequest.current = null; setBusy(false);
    }
  }
  async function cancel(item: Reservation) {
    if (
      !confirm(
        `Cancel the reservation for unit ${item.unit.number} and release the unit?`,
      )
    )
      return;
    setError("");
    const response = await fetch(
      `/api/v1/reservations?id=${encodeURIComponent(item.id)}`,
      { method: "DELETE" },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(
        payload.error?.message ?? "The reservation could not be cancelled.",
      );
      return;
    }
    setNotice(
      payload.data.unitReleased
        ? `Reservation cancelled. Unit ${item.unit.number} is available again.`
        : `Reservation cancelled, but unit ${item.unit.number} remains protected by another active reservation or occupancy. Review it under Units & rates.`,
    );
    await load();
  }
  async function extend(item: Reservation) {
    const current = item.holdExpiresAt ? item.holdExpiresAt.slice(0, 10) : "";
    const date = prompt(
      "Extend the hold until which date? Use YYYY-MM-DD.",
      current,
    );
    if (!date) return;
    const reason = prompt("Record the reason for this extension.");
    if (!reason) return;
    setError("");
    const response = await fetch("/api/v1/reservations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "EXTEND",
        reservationId: item.id,
        holdExpiresAt: `${date}T23:59:59.999+02:00`,
        reason,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(
        response.status === 409
          ? "Choose a future date later than the current hold expiry."
          : (payload.error?.message ??
              "The reservation could not be extended."),
      );
      return;
    }
    setNotice(
      `Reservation for unit ${item.unit.number} extended to ${formatDate(payload.data.holdExpiresAt)}.`,
    );
    await load();
  }
  async function expire(item: Reservation) {
    if (
      !confirm(
        `Expire the overdue reservation for unit ${item.unit.number} and release the unit?`,
      )
    )
      return;
    const reason = prompt(
      "Record the reason for expiring this reservation.",
      "Hold expired without conversion",
    );
    if (!reason) return;
    setError("");
    const response = await fetch("/api/v1/reservations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "EXPIRE",
        reservationId: item.id,
        reason,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(
        response.status === 409
          ? "Only an active overdue reservation can be expired."
          : (payload.error?.message ?? "The reservation could not be expired."),
      );
      return;
    }
    setNotice(
      payload.data.unitReleased
        ? `Reservation expired. Unit ${item.unit.number} is available again.`
        : `Reservation expired, but unit ${item.unit.number} remains protected by another active reservation or occupancy.`,
    );
    await load();
  }
  return (
    <div className="page-stack reservations-workspace">
      <PageHeader
        eyebrow="Lead to lease"
        title="Reservations & holds"
        description="Reserve available units, monitor hold expiry and convert confirmed reservations into move-ins."
        action={
          <button
            className="button button-primary"
            data-guide="reservation-create"
            onClick={() => {
              setDialog(true);
              setError("");
            }}
            disabled={
              !data.facilities.some((facility) => facility.units.length) ||
              !data.customers.length
            }
          >
            <Plus size={16} />
            New reservation
          </button>
        }
      />
      <div>
        <button className="button button-secondary" disabled={readBusy || busy} onClick={() => void load()}>Refresh reservations</button>
        {readBusy ? <p role="status">Loading reservations…</p> : null}
        {readError ? <p className="form-error" role="alert">{readError}</p> : null}
        {signedOut ? <Link className="button button-primary" href="/login">Sign in</Link> : null}
      </div>
      {error && !dialog ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}
      <section className="summary-strip">
        {[
          [
            "Active holds",
            data.reservations.filter((item) => item.status === "ACTIVE").length,
          ],
          ["Expiring / overdue", expiring],
          [
            "Converted",
            data.reservations.filter((item) => item.status === "CONVERTED")
              .length,
          ],
          [
            "Available units",
            data.facilities.reduce(
              (sum, facility) => sum + facility.units.length,
              0,
            ),
          ],
        ].map(([label, count]) => (
          <div className="summary-cell" key={label}>
            <span>{label}</span>
            <strong>{loaded ? count : "—"}</strong>
          </div>
        ))}
      </section>
      <section className="panel reservation-toolbar" data-guide="reservation-filters">
        <label>
          Store
          <select
            value={facilityId}
            onChange={(event) => setFacilityId(event.target.value)}
          >
            <option value="">All permitted stores</option>
            {data.facilities.map((facility) => (
              <option value={facility.id} key={facility.id}>
                {facility.name}
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
            {["ACTIVE", "CONVERTED", "CANCELLED", "EXPIRED"].map((item) => (
              <option value={item} key={item}>
                {item.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Search</span>
          <span className="toolbar-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Customer, unit or type"
            />
          </span>
        </label>
      </section>
      <section className="panel" data-guide="reservation-list">
        {!visible.length ? <p className="empty-cell">{loaded ? "No reservations match these filters." : readBusy ? "Loading reservations…" : "Reservation records are unavailable."}</p> : <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Store</th>
                <th>Unit</th>
                <th>Quoted rate</th>
                <th>Hold expires</th>
                <th>Intended move-in</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? (
                visible.map((item) => {
                  const overdue =
                    item.status === "ACTIVE" &&
                    item.holdExpiresAt &&
                    new Date(item.holdExpiresAt).getTime() < now;
                  return (
                    <tr key={item.id}>
                      <td className="primary-cell">
                        {customerName(item.customer)}
                        <small>
                          {item.customer.phone || item.customer.email}
                        </small>
                      </td>
                      <td>{item.facility.name}</td>
                      <td>
                        <strong>{item.unit.number}</strong>
                        <small>{item.unit.unitType.name}</small>
                      </td>
                      <td>
                        R{" "}
                        {Number(item.quotedRate).toLocaleString("en-ZA", {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                      <td className={overdue ? "reservation-overdue" : ""}>
                        {formatDate(item.holdExpiresAt)}
                        {overdue ? <small>Overdue</small> : null}
                      </td>
                      <td>{formatDate(item.intendedMoveIn)}</td>
                      <td>
                        <StatusPill
                          tone={
                            item.status === "ACTIVE"
                              ? overdue
                                ? "warning"
                                : "positive"
                              : "neutral"
                          }
                        >
                          {item.status}
                        </StatusPill>
                      </td>
                      <td>
                        {item.status === "ACTIVE" ? (
                          <div className="reservation-actions">
                            <Link
                              href={`/operations/move-in?reservation=${encodeURIComponent(item.id)}`}
                              className="text-button"
                            >
                              Move in
                            </Link>
                            <button
                              className="text-button"
                              onClick={() => void extend(item)}
                            >
                              Extend
                            </button>
                            {overdue ? (
                              <button
                                className="text-button danger"
                                onClick={() => void expire(item)}
                              >
                                Expire
                              </button>
                            ) : null}
                            <button
                              className="text-button danger"
                              onClick={() => void cancel(item)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    {loaded ? "No reservations match these filters." : readBusy ? "Loading reservations…" : "Reservation records are unavailable."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>}
      </section>
      {dialog ? (
        <ReservationDialog
          data={data}
          defaultFacilityId={facilityId || data.facilities[0]?.id || ""}
          busy={busy}
          error={createBlocked ? uncertainCreate : error}
          blocked={createBlocked}
          review={() => void load()}
          close={() => setDialog(false)}
          create={create}
        />
      ) : null}
    </div>
  );
}

function ReservationDialog({
  data,
  defaultFacilityId,
  busy,
  error,
  close,
  create,
  blocked,
  review,
}: {
  data: Payload;
  defaultFacilityId: string;
  busy: boolean;
  error: string;
  close: () => void;
  create: (form: FormData) => void;
  blocked: boolean;
  review: () => void;
}) {
  const [facilityId, setFacilityId] = useState(defaultFacilityId);
  const units =
    data.facilities.find((facility) => facility.id === facilityId)?.units ?? [];
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const [defaultExpiry] = useState(() =>
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  );
  return (
    <div className="modal-backdrop">
      <div className="modal-card reservation-modal">
        <button className="modal-close" onClick={close} disabled={busy} aria-label="Close reservation form">
          <X size={18} />
        </button>
        <p className="eyebrow">Inventory hold</p>
        <h2>New reservation</h2>
        <form onSubmit={event => { event.preventDefault(); create(new FormData(event.currentTarget)); }} className="inventory-form">
          <label>
            Store
            <select
              name="facilityId"
              value={facilityId}
              onChange={(event) => {
                const next = event.target.value;
                setFacilityId(next);
                setUnitId(
                  data.facilities.find((facility) => facility.id === next)
                    ?.units[0]?.id ?? "",
                );
              }}
            >
              {data.facilities.map((facility) => (
                <option value={facility.id} key={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Customer
            <select name="customerId" required>
              <option value="">Select customer</option>
              {data.customers.map((customer) => (
                <option value={customer.id} key={customer.id}>
                  {customerName(customer)}
                </option>
              ))}
            </select>
          </label>
          <label className="inventory-form-wide">
            Available unit
            <select
              name="unitId"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              required
            >
              {units.map((unit) => (
                <option value={unit.id} key={unit.id}>
                  {unit.number} · {unit.unitType.name}
                  {unit.unitType.areaSqMetres
                    ? ` · ${unit.unitType.areaSqMetres} m²`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quoted monthly rate (R)
            <input
              name="quotedRate"
              type="number"
              step=".01"
              min="0"
              key={selectedUnit?.id}
              defaultValue={selectedUnit?.monthlyRate}
              required
            />
          </label>
          <label>
            Hold expires
            <input
              name="holdExpiresAt"
              type="date"
              defaultValue={defaultExpiry}
            />
          </label>
          <label>
            Intended move-in
            <input name="intendedMoveIn" type="date" />
          </label>
          {error ? (
            <p className="form-error inventory-form-wide" role="alert">{error}</p>
          ) : null}
          <div className="form-actions inventory-form-wide">
            <button
              type="button"
              className="button button-secondary"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={busy || blocked || !units.length}
            >
              <CalendarCheck size={15} />
              {busy ? "Reserving…" : "Reserve unit"}
            </button>
            {blocked ? <button type="button" className="button button-secondary" onClick={review}>Review reservations</button> : null}
          </div>
        </form>
      </div>
    </div>
  );
}

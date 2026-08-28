"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, CheckCircle2, ClipboardList, Plus, RefreshCw, Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import Link from "next/link";
import { formatSouthAfricaDate, formatSouthAfricaDateTime } from "@/lib/south-africa-time";

type Task = { id: string; title: string; status: string; priority: string; dueAt: string | null; facility?: { name: string } | null; assignee?: { name: string } | null };
type Maintenance = { id: string; title: string; status: string; priority: string; unit?: { number: string } | null; facility: { name: string } };
type Product = { id: string; sku: string; name: string; quantityOnHand: number; reorderPoint: number; sellingPrice: string; facility: { name: string } };
type Close = { id: string; businessDate: string; status: string; variance: string | null; facility: { name: string } };
type Facility = { id: string; name: string; units: { id: string; number: string; status: string }[] };
type OperationsData = { tasks: Task[]; maintenance: Maintenance[]; products: Product[]; dailyCloses: Close[]; notes: unknown[]; facilities: Facility[] };

export function OperationsWorkspace() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [maintenanceFacilityId, setMaintenanceFacilityId] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/operations", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error?.message ?? "Operations data could not be loaded."); return; }
    setData(payload.data); setError("");
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/operations", { cache: "no-store" }).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => {
      if (cancelled) return;
      if (!response.ok) setError(payload.error?.message ?? "Operations data could not be loaded.");
      else setData(payload.data);
    });
    return () => { cancelled = true; };
  }, []);

  async function createTask(formData: FormData) {
    setBusy(true);
    const response = await fetch("/api/v1/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "task", payload: { facilityId: formData.get("facilityId") || undefined, title: formData.get("title"), description: formData.get("description") || undefined, priority: formData.get("priority"), dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))).toISOString() : undefined } }) });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Task could not be created."); return; }
    setShowTask(false); await load();
  }

  async function completeTask(id: string) {
    await fetch(`/api/v1/operations/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "COMPLETED" }) });
    await load();
  }

  async function createMaintenance(formData: FormData) {
    setBusy(true);
    const response = await fetch("/api/v1/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "maintenance",
        payload: {
          facilityId: formData.get("facilityId"),
          unitId: formData.get("unitId") || undefined,
          title: formData.get("title"),
          description: formData.get("description") || undefined,
          priority: formData.get("priority"),
          dueAt: formData.get("dueAt") ? new Date(String(formData.get("dueAt"))).toISOString() : undefined,
        },
      }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Maintenance request could not be created."); return; }
    setShowMaintenance(false);
    setMaintenanceFacilityId("");
    await load();
  }

  async function updateMaintenance(id: string, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
    setBusy(true);
    const response = await fetch(`/api/v1/operations/maintenance/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Maintenance request could not be updated."); return; }
    await load();
  }

  const openTasks = data?.tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status)) ?? [];
  const service = data?.maintenance.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status)) ?? [];
  const reorder = data?.products.filter((product) => product.quantityOnHand <= product.reorderPoint) ?? [];

  return <div className="page-stack">
    <PageHeader eyebrow="Facility workflows" title="Operations centre" description="Database-backed work queues, maintenance, inventory and end-of-day control for Stor24." action={<button className="button button-primary" onClick={() => setShowTask(true)}><Plus size={16}/> New task</button>} />
    {error ? <p className="form-error">{error}</p> : null}
    <section className="summary-strip">
      {[["Open tasks", openTasks.length], ["Service required", service.length], ["Reorder items", reorder.length], ["Daily closes", data?.dailyCloses.length ?? 0]].map(([label, value]) => <div className="summary-cell" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </section>
    <section className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Accounts</p><h2>Customer account workflows</h2><p className="panel-subtitle">Start the primary rental and billing workflows from one place.</p></div></div><div className="operations-account-grid">
      <Link href="/operations/move-in"><strong>Move in</strong><span>Select a vacant unit and create the tenancy account.</span></Link>
      <Link href="/operations/accounts"><strong>Payments</strong><span>Post and review customer payments.</span></Link>
      <Link href="/operations/accounts"><strong>Transfer</strong><span>Move an active tenant to another available unit.</span></Link>
      <Link href="/operations/accounts"><strong>Move out</strong><span>Close an occupancy and release the unit.</span></Link>
    </div></section>
    <section className="dashboard-grid">
      <article className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Work queues</p><h2>Assigned operational tasks</h2></div><ClipboardList size={21}/></div>
        <div className="work-list">{openTasks.length ? openTasks.map((task) => <div className="work-row" key={task.id}><span className={`work-icon ${task.priority === "URGENT" ? "work-icon-danger" : task.priority === "HIGH" ? "work-icon-warning" : ""}`}><ClipboardList size={18}/></span><span className="work-copy"><strong>{task.title}</strong><small>{task.facility?.name ?? "Portfolio"} · {task.assignee?.name ?? "Unassigned"} · {task.dueAt ? `${formatSouthAfricaDateTime(task.dueAt)} SAST` : "No due date"}</small></span><button className="text-button" onClick={() => completeTask(task.id)}>Complete</button></div>) : <div className="empty-state"><CheckCircle2 size={32}/><strong>No open tasks</strong><p>Create a task to start the facility work queue.</p></div>}</div>
      </article>
      <article className="panel panel-spacious"><div className="panel-heading"><div><p className="eyebrow">Service required</p><h2>Maintenance queue</h2></div><button className="button button-secondary" onClick={() => setShowMaintenance(true)}><Plus size={16}/> New request</button></div>
        <div className="work-list">{service.length ? service.map((item) => <div className="work-row" key={item.id}><span className="work-icon work-icon-warning"><Wrench size={18}/></span><span className="work-copy"><strong>{item.title}</strong><small>{item.facility.name}{item.unit ? ` · Unit ${item.unit.number}` : ""}</small></span><StatusPill tone={item.priority === "URGENT" ? "danger" : "warning"}>{item.status}</StatusPill><span className="inline-actions">{item.status !== "IN_PROGRESS" ? <button className="text-button" disabled={busy} onClick={() => updateMaintenance(item.id, "IN_PROGRESS")}>Start</button> : null}<button className="text-button" disabled={busy} onClick={() => updateMaintenance(item.id, "COMPLETED")}>Complete</button><button className="text-button" disabled={busy} onClick={() => updateMaintenance(item.id, "CANCELLED")}>Cancel</button></span></div>) : <div className="empty-state"><Wrench size={32}/><strong>No service requests</strong><p>Unit and facility maintenance will appear here.</p></div>}</div>
      </article>
    </section>
    <section className="dashboard-grid">
      <article className="panel"><div className="hub-heading"><div><h2>Merchandise stock</h2><p>On-hand quantities and reorder thresholds.</p></div><Boxes size={20}/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Facility</th><th>On hand</th><th>Reorder</th></tr></thead><tbody>{data?.products.length ? data.products.map((product) => <tr key={product.id}><td className="primary-cell">{product.name}<span className="secondary-cell">{product.sku}</span></td><td>{product.facility.name}</td><td>{product.quantityOnHand}</td><td><StatusPill tone={product.quantityOnHand <= product.reorderPoint ? "warning" : "positive"}>{product.quantityOnHand <= product.reorderPoint ? "Reorder" : "Healthy"}</StatusPill></td></tr>) : <tr><td colSpan={4} className="empty-cell">No merchandise configured.</td></tr>}</tbody></table></div></article>
      <article className="panel"><div className="hub-heading"><div><h2>End-of-day control</h2><p>Closed periods and recorded cash variance.</p></div><RefreshCw size={20}/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Facility</th><th>Status</th><th>Variance</th></tr></thead><tbody>{data?.dailyCloses.length ? data.dailyCloses.map((close) => <tr key={close.id}><td>{formatSouthAfricaDate(close.businessDate)}</td><td>{close.facility.name}</td><td><StatusPill tone="positive">{close.status}</StatusPill></td><td>{close.variance ?? "—"}</td></tr>) : <tr><td colSpan={4} className="empty-cell">No daily closes recorded.</td></tr>}</tbody></table></div></article>
    </section>
    {showTask ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Work queue</p><h2>Create operational task</h2><form action={createTask} className="invite-form"><label>Facility<select name="facilityId" required><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Title<input name="title" required minLength={2}/></label><label>Description<textarea name="description" rows={4}/></label><label>Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><label>Due date<input name="dueAt" type="datetime-local"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowTask(false)}>Cancel</button><button className="button button-primary" disabled={busy || !data?.facilities.length}>{busy ? "Saving…" : "Create task"}</button></div></form></div></div> : null}
    {showMaintenance ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><p className="eyebrow">Unit availability</p><h2>Create maintenance request</h2><p className="panel-subtitle">Selecting a unit immediately removes it from bookable availability until all linked maintenance is complete.</p><form action={createMaintenance} className="invite-form"><label>Facility<select name="facilityId" required value={maintenanceFacilityId} onChange={(event) => setMaintenanceFacilityId(event.target.value)}><option value="">Choose facility</option>{data?.facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label><label>Unit (optional)<select name="unitId" defaultValue=""><option value="">Facility-level request</option>{data?.facilities.find((facility) => facility.id === maintenanceFacilityId)?.units.map((unit) => <option key={unit.id} value={unit.id}>Unit {unit.number}{unit.status === "SERVICE" ? " · already in service" : ""}</option>)}</select></label><label>Title<input name="title" required minLength={2}/></label><label>Description<textarea name="description" rows={4}/></label><label>Priority<select name="priority" defaultValue="NORMAL"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></label><label>Due date<input name="dueAt" type="datetime-local"/></label><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowMaintenance(false); setMaintenanceFacilityId(""); }}>Cancel</button><button className="button button-primary" disabled={busy || !maintenanceFacilityId}>{busy ? "Saving…" : "Create request"}</button></div></form></div></div> : null}
  </div>;
}

"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { ClipboardList, Columns3, List, Table2 } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";

export type OperationsQueueTask = { purpose?: string; id: string; title: string; description?: string | null; customerId?: string | null; status: string; priority: string; dueAt: string | null; facility?: { name: string } | null; assignee?: { name: string } | null };
const views = [{ value: "list", label: "List", icon: List }, { value: "table", label: "Table", icon: Table2 }, { value: "kanban", label: "Kanban", icon: Columns3 }] as const;
type QueueView = typeof views[number]["value"];
const statuses = [{ value: "OPEN", label: "Open" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "WAITING", label: "Waiting" }, { value: "COMPLETED", label: "Completed" }, { value: "CANCELLED", label: "Cancelled" }];
const preferenceEvent = "stor24-operations-view-change";
const unsavedViews = new Map<string, QueueView>();
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(preferenceEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(preferenceEvent, callback); };
}
const serverSnapshot = () => "list" as const;
const dueDate = (task: OperationsQueueTask) => task.dueAt ? `${formatSouthAfricaDateTime(task.dueAt)} SAST` : "No due date";

function TaskDetails({ task }: { task: OperationsQueueTask }) {
  return <div className="work-copy"><strong>{task.title}</strong>{task.description ? <details><summary>View request details</summary><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{task.description}</p>{task.customerId ? <Link href={`/tenants?customer=${encodeURIComponent(task.customerId)}`}>Open customer record →</Link> : null}</details> : null}</div>;
}

function TaskActions({ task, blocked, busy, onComplete }: { task: OperationsQueueTask; blocked: boolean; busy: boolean; onComplete: (id: string) => void }) {
  return <span className="operations-task-row-actions"><StatusPill tone={task.status === "COMPLETED" ? "positive" : "neutral"}>{task.status.replaceAll("_", " ")}</StatusPill>{task.purpose === "ARREARS_ACCESS_REVIEW" ? <Link className="text-button" href="/collections">Open Collections</Link> : null}{task.purpose === "OPERATIONAL_FORM" ? <Link className="text-button" href={`/operations/forms?id=${task.id}`}>Open form</Link> : null}{task.purpose === "OPERATIONAL_CHECKLIST" ? <Link className="text-button" href={`/operations/checklists?id=${task.id}`}>Open checklist</Link> : null}{!["OPERATIONAL_CHECKLIST", "OPERATIONAL_FORM"].includes(task.purpose ?? "") && !["COMPLETED", "CANCELLED"].includes(task.status) ? task.purpose === "AGREED_FOLLOWUP" ? <Link className="text-button" href={task.customerId ? `/tenants?customer=${encodeURIComponent(task.customerId)}&section=followups` : "/operations/followups"}>Open appointment</Link> : <button className="text-button" disabled={blocked} onClick={() => onComplete(task.id)}>{busy ? "Please wait…" : "Complete"}</button> : null}</span>;
}

export function OperationsTaskQueue({ tasks, userId, blocked, busy, onComplete }: { tasks: OperationsQueueTask[]; userId?: string; blocked: boolean; busy: boolean; onComplete: (id: string) => void }) {
  const key = userId ? `stor24:operations-queue-view:${userId}` : null;
  const snapshot = useCallback((): QueueView => {
    if (!key) return "list";
    if (unsavedViews.has(key)) return unsavedViews.get(key)!;
    try { const saved = window.localStorage.getItem(key); return views.some(view => view.value === saved) ? saved as QueueView : "list"; } catch { return "list"; }
  }, [key]);
  const view = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const choose = (next: QueueView) => {
    if (!key) return;
    try { window.localStorage.setItem(key, next); unsavedViews.delete(key); }
    catch { unsavedViews.set(key, next); }
    window.dispatchEvent(new Event(preferenceEvent));
  };
  const actions = (task: OperationsQueueTask) => <TaskActions task={task} blocked={blocked} busy={busy} onComplete={onComplete}/>;
  const metadata = (task: OperationsQueueTask) => <small>{task.facility?.name ?? "Portfolio"} · {task.assignee?.name ?? "Unassigned"} · {dueDate(task)}</small>;
  return <div className="operations-queue">
    {key ? <div className="operations-queue-views" role="group" aria-label="Task queue view">{views.map(({ value, label, icon: Icon }) => <button key={value} type="button" className={`button ${view === value ? "button-primary" : "button-secondary"}`} aria-pressed={view === value} onClick={() => choose(value)}><Icon size={16} aria-hidden="true"/>{label}</button>)}</div> : null}
    {tasks.length ? view === "table" ? <div className="operations-queue-table table-wrap" role="region" aria-label="Task table" tabIndex={0}><table className="data-table"><caption>Filtered operational tasks</caption><thead><tr>{["Task", "Store", "Assigned to", "Due date (SAST)", "Status / action"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{tasks.map(task => <tr key={task.id}><td><TaskDetails task={task}/></td><td>{task.facility?.name ?? "Portfolio"}</td><td>{task.assignee?.name ?? "Unassigned"}</td><td>{dueDate(task)}</td><td>{actions(task)}</td></tr>)}</tbody></table></div> : view === "kanban" ? <div className="operations-queue-board" aria-label="Tasks by status">{statuses.map(status => {
      const items = tasks.filter(task => task.status === status.value);
      return <section className="operations-queue-column" aria-label={`${status.label} tasks`} key={status.value}><h3>{status.label}<span>{items.length}</span></h3>{items.length ? items.map(task => <article className="operations-queue-card" key={task.id}><TaskDetails task={task}/>{metadata(task)}{actions(task)}</article>) : <p className="panel-subtitle">No matching tasks</p>}</section>;
    })}</div> : <div className="work-list">{tasks.map(task => <div className="work-row operations-task-row" key={task.id}><span className={`work-icon ${task.priority === "URGENT" ? "work-icon-danger" : task.priority === "HIGH" ? "work-icon-warning" : ""}`}><ClipboardList size={18}/></span><div className="operations-queue-list-copy"><TaskDetails task={task}/>{metadata(task)}</div>{actions(task)}</div>)}</div> : null}
  </div>;
}

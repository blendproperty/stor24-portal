"use client";

import { useRef, useState } from "react";
import { z } from "zod";

const previewSchema = z.object({ data: z.object({
  customers: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  counts: z.record(z.string(), z.number()), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}) });
const confirmationText = "DELETE SELECTED TEST CUSTOMERS";
type Customer = { id: string; name: string; contact: string };

export function TestCustomerCleanup({ customers, disabled, onDeleted }: { customers: Customer[]; disabled: boolean; onDeleted: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(false);
  const [ids, setIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<z.infer<typeof previewSchema>["data"] | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const visible = customers.filter(c => `${c.name} ${c.contact} ${c.id}`.toLowerCase().includes(search.toLowerCase()));

  async function submit(action: "preview" | "delete") {
    if (request.current || blocked) return;
    request.current = true; setBusy(true); setError("");
    if (action === "preview") dialog.current?.querySelector(".test-cleanup-body")?.scrollTo(0, 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/v1/admin/test-customers", { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ids,
          ...(action === "delete" ? { fingerprint: review?.fingerprint, confirmation } : {}),
        }),
      });
      if (!response.ok) {
        if (![400, 401, 403, 404, 409, 422].includes(response.status)) throw new Error("UNCERTAIN");
        const payload = await response.json();
        setError(payload.error?.message || "Request rejected. Refresh and review the selection again.");
        setReview(null); setConfirmation(""); return;
      }
      if (action === "preview") {
        const data = previewSchema.parse(await response.json()).data;
        if (data.customers.length !== ids.length || data.customers.some(c => !ids.includes(c.id))) throw new Error("INVALID_PREVIEW");
        setReview(data);
      } else {
        setNotice(`${ids.length} test customer${ids.length === 1 ? "" : "s"} deleted. Linked test records removed; audit history retained.`);
        dialog.current?.close(); setIds([]); setReview(null); setConfirmation(""); await onDeleted();
      }
    } catch {
      if (action === "delete") { setBlocked(true); setError("Deletion outcome could not be confirmed. Reload this page and check the result before attempting another cleanup."); }
      else setError("Preview could not be loaded. Try again.");
    } finally { clearTimeout(timer); request.current = false; setBusy(false); }
  }

  return <><button type="button" className="button button-secondary" disabled={disabled || busy || blocked} onClick={() => { setError(""); setNotice(""); setIds([]); setReview(null); setConfirmation(""); dialog.current?.showModal(); }}>Delete test customers</button>
    {notice ? <p role="status">{notice}</p> : null}
    <dialog ref={dialog} className="test-cleanup" aria-labelledby="test-cleanup-title" onCancel={event => { if (busy || blocked) event.preventDefault(); }}>
      <header className="test-cleanup-header"><p className="eyebrow">Customer cleanup</p><h2 id="test-cleanup-title">Delete selected test customers</h2><p>Select only customers you created for testing.</p></header>
      <div className="test-cleanup-body">
      <div className="test-cleanup-warning"><strong>Permanent deletion</strong><p>Selected customers and their linked test records will be removed. Customer and reporting totals will change.</p>
        <details><summary>What gets removed?</summary><p>Linked enquiries, bookings, accounts, payments, agreements, mandates, documents, local access and insurance records are removed. Pending local jobs are cancelled and unused units released. Audit and communication history remain. This removes CRM records; it does not undo payments or cancel services already held by external providers.</p></details>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!review ? <><label className="test-cleanup-search">Find test customers<input placeholder="Search name, email, phone or reference" value={search} disabled={busy || blocked} onChange={e => setSearch(e.target.value)}/></label>
        <div className="test-cleanup-tools"><span>{visible.length} customers · {ids.length} selected</span><button type="button" className="button button-secondary" disabled={busy || blocked || visible.length > 100 || !visible.length} onClick={() => setIds(visible.map(c => c.id))}>Select all matching ({visible.length})</button><button type="button" className="button button-secondary" disabled={busy || blocked} onClick={() => setIds([])}>Clear selection</button></div>
        <div className="test-cleanup-list" role="group" aria-label="Choose test customers">{visible.map(c => <label className="test-cleanup-row" key={c.id}><input type="checkbox" checked={ids.includes(c.id)} disabled={busy || blocked || (!ids.includes(c.id) && ids.length >= 100)} onChange={e => setIds(current => e.target.checked ? [...current, c.id] : current.filter(id => id !== c.id))}/><span className="test-cleanup-customer"><strong>{c.name}</strong><span>{c.contact || "No contact details"}</span></span><span className="test-cleanup-ref">Ref {c.id.slice(-6).toUpperCase()}</span></label>)}
        {!visible.length ? <p className="test-cleanup-empty">No matching customers.</p> : null}</div>
      </> : <><h3>Review {review.customers.length} selected customers</h3><ul className="test-cleanup-review-list">{review.customers.map(c => <li key={c.id}>{c.name} · Ref {c.id.slice(-6).toUpperCase()}</li>)}</ul>
        <dl className="test-cleanup-counts">{Object.entries(review.counts).filter(([, count]) => count > 0).map(([key, count]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{count}</dd></div>)}</dl>
        <p>This cannot be undone. Confirm every selected customer and their linked records are tests.</p>
        <label className="test-cleanup-search">Type {confirmationText}<input style={{ width: "100%", minWidth: 0 }} value={confirmation} disabled={busy || blocked} autoComplete="off" onChange={e => setConfirmation(e.target.value)}/></label>
      </>}
      </div><footer className="test-cleanup-footer"><span>{ids.length} selected</span><div className="test-cleanup-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => dialog.current?.close()}>Keep customers</button>
        {review ? <><button type="button" className="button button-secondary" disabled={busy || blocked} onClick={() => { setReview(null); setConfirmation(""); }}>Change selection</button><button type="button" className="button button-primary" disabled={busy || blocked || confirmation !== confirmationText} onClick={() => void submit("delete")}>{busy ? "Deleting…" : "Permanently delete selected tests"}</button></> : <button type="button" className="button button-primary" disabled={busy || blocked || !ids.length} onClick={() => void submit("preview")}>{busy ? "Reviewing…" : `Review ${ids.length} selected`}</button>}
      </div></footer>
    </dialog></>;
}

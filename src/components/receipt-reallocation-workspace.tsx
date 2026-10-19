"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "./page-header";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import { receiptCents, receiptReallocationInput, receiptReallocationNotice, type ReceiptReallocationInput } from "@/lib/receipt-reallocation-policy";
import { RECEIPT_CORRECTION_ENDPOINT, receiptCorrectionWorkspaceSchema, receiptCorrectionPreviewSchema, type ReceiptCorrectionWorkspace, type ReceiptCorrectionPreview, type ReceiptCorrectionRow, type ReceiptCorrectionCommand } from "@/lib/receipt-reallocation-ui-contract";
import styles from "./receipt-reallocation-workspace.module.css";

type AccountChoice = { id: string; accountNumber: string; customerName: string; facilityId: string };
type SavedRequest = Extract<ReceiptCorrectionCommand, { action: "request" }>;
const zar = (value: string) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value));

export function ReceiptReallocationWorkspace({ training = false }: { training?: boolean }) {
  const endpoint = training ? "/api/v1/training/receipt-corrections" : RECEIPT_CORRECTION_ENDPOINT;
  const [data, setData] = useState<ReceiptCorrectionWorkspace | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [search, setSearch] = useState("");
  const appliedSearch = useRef("");
  const [source, setSource] = useState<AccountChoice | null>(null);
  const [target, setTarget] = useState<AccountChoice | null>(null);
  const [entryId, setEntryId] = useState("");
  const [undo, setUndo] = useState<ReceiptCorrectionRow | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [preview, setPreview] = useState<{ value: ReceiptCorrectionPreview; input: ReceiptReallocationInput } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState<SavedRequest | null>(null);
  const [decisionNeedsCheck, setDecisionNeedsCheck] = useState(false);
  const [readBusy, setReadBusy] = useState(true);
  const [writeBusy, setWriteBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generation, setGeneration] = useState(0);
  const reader = useRef<AbortController | null>(null);
  const writer = useRef<AbortController | null>(null);
  const requestKey = useRef<string | null>(null);
  const sourceAccountId = source?.id ?? "";

  const invalidate = () => { setPreview(null); setConfirmed(false); setError(""); requestKey.current = null; };
  const load = useCallback(async (cursor?: string, receiptCursor?: string) => {
    reader.current?.abort();
    const controller = new AbortController(); reader.current = controller;
    setReadBusy(true); setReadError("");
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const params = new URLSearchParams();
      if (facilityId) params.set("facilityId", facilityId);
      if (sourceAccountId) params.set("sourceAccountId", sourceAccountId);
      if (appliedSearch.current.trim()) params.set("search", appliedSearch.current.trim());
      if (cursor) params.set("cursor", cursor);
      if (receiptCursor && sourceAccountId) params.set("receiptCursor", receiptCursor);
      const response = await fetch(`${endpoint}?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw Error(response.status === 401 ? "Sign in again to review receipt corrections." : response.status === 403 ? "Your account cannot view receipt corrections for this store." : "Receipt corrections could not be loaded. Refresh to try again.");
      const parsed = receiptCorrectionWorkspaceSchema.safeParse((await response.json()).data);
      if (!parsed.success) throw Error("The receipt correction records could not be verified. Refresh before continuing.");
      if (reader.current !== controller) return;
      setData(previous => {
        if (receiptCursor && previous) return {
          ...parsed.data,
          receipts: [...previous.receipts.map(receipt => parsed.data.receipts.find(fresh => fresh.entryId === receipt.entryId) ?? receipt), ...parsed.data.receipts.filter(receipt => !previous.receipts.some(existing => existing.entryId === receipt.entryId))],
          requests: [...parsed.data.requests, ...previous.requests.filter(row => !parsed.data.requests.some(fresh => fresh.id === row.id))],
          nextCursor: previous.nextCursor,
        };
        if (cursor && previous) return {
          ...parsed.data,
          requests: [...previous.requests.map(row => parsed.data.requests.find(fresh => fresh.id === row.id) ?? row), ...parsed.data.requests.filter(row => !previous.requests.some(existing => existing.id === row.id))],
          receipts: [...previous.receipts.map(receipt => parsed.data.receipts.find(fresh => fresh.entryId === receipt.entryId) ?? receipt), ...parsed.data.receipts.filter(receipt => !previous.receipts.some(existing => existing.entryId === receipt.entryId))],
          nextReceiptCursor: previous.nextReceiptCursor,
        };
        return parsed.data;
      });
      setGeneration(value => value + 1); setDecisionNeedsCheck(false);
    } catch (failure) {
      if (reader.current === controller) { setData(null); setPreview(null); setConfirmed(false); setReadError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "The receipt review timed out. Refresh to try again."); }
    } finally { clearTimeout(timer); if (reader.current === controller) { reader.current = null; setReadBusy(false); } }
  }, [facilityId, sourceAccountId, endpoint]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); reader.current?.abort(); }; }, [load]);
  useEffect(() => () => { reader.current?.abort(); writer.current?.abort(); writer.current = null; }, []);

  async function command(input: ReceiptCorrectionCommand) {
    if (writer.current) throw Error("Wait for the current receipt review action.");
    const controller = new AbortController(); writer.current = controller; setWriteBusy(true);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw Error(typeof result?.error?.message === "string" ? result.error.message : "The receipt correction could not be confirmed.");
      return result.data as unknown;
    } finally { clearTimeout(timer); if (writer.current === controller) { writer.current = null; setWriteBusy(false); } }
  }
  async function prepare() {
    setError(""); setMessage(""); setPreview(null); setConfirmed(false);
    requestKey.current ??= crypto.randomUUID();
    const input = receiptReallocationInput.safeParse({ operation: undo ? "UNDO" : "MOVE", reversesId: undo?.id ?? null, sourceAccountId: source?.id, targetAccountId: target?.id, sourceEntryId: entryId, amount, reason, evidenceReference: evidence, requestKey: requestKey.current });
    if (!input.success || receiptCents(input.data.amount) <= 0 || !data?.receipts.some(receipt => receipt.entryId === input.data.sourceEntryId)) { setError("Choose both accounts and an available receipt, a positive amount, a reason of at least 10 characters and an evidence reference of at least 5 characters."); return; }
    try {
      const parsed = receiptCorrectionPreviewSchema.safeParse(await command({ action: "preview", input: input.data }));
      if (!parsed.success) throw Error("The correction preview could not be verified. Refresh and check the source again.");
      const value = parsed.data;
      if (value.operation !== input.data.operation || receiptCents(value.amount) !== receiptCents(input.data.amount) || value.source.accountNumber !== source?.accountNumber || value.target.accountNumber !== target?.accountNumber) throw Error("The preview differs from the selected correction. Refresh and check the source again.");
      setPreview({ value, input: input.data });
    } catch (failure) { setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "The preview timed out. Check the source and try again."); }
  }
  async function submit(saved?: SavedRequest) {
    if (!saved && (!preview || !confirmed)) return;
    const input: SavedRequest = saved ?? { action: "request", input: preview!.input, fingerprint: preview!.value.fingerprint, confirmed: true };
    setError(""); setMessage("");
    try {
      const result = await command(input) as { id?: unknown; idempotent?: unknown };
      if (typeof result?.id !== "string" || typeof result.idempotent !== "boolean") throw Error("The saved request could not be verified.");
      setUncertain(null); setPreview(null); setConfirmed(false); requestKey.current = null; setEntryId("");
      setMessage(training ? "Training request saved. Live balances are unchanged; approval and posting are unavailable in training." : "Request recorded for independent review. No second payment or provider refund was created."); await load();
    } catch { setUncertain(input); setPreview(null); setConfirmed(false); setError("We could not confirm whether this request was saved. Its account details and request reference are retained. Check the recorded requests or retry exactly the same request."); }
  }
  async function decide(row: ReceiptCorrectionRow, decision: "approve" | "reject" | "cancel", reference: string) {
    setError(""); setMessage("");
    try {
      const result = await command({ action: "decide", id: row.id, revision: row.revision, decision, reference, confirmed: true }) as { id?: unknown; status?: unknown; idempotent?: unknown };
      const expected = decision === "approve" ? "POSTED" : decision === "reject" ? "REJECTED" : "CANCELLED";
      if (result?.id !== row.id || result.status !== expected || typeof result.idempotent !== "boolean") throw Error("Decision not verified");
      setMessage(decision === "approve" ? "Correction posted. The original provider payment remains unchanged." : `Request ${decision === "reject" ? "rejected" : "cancelled"}.`);
      invalidate(); await load();
    } catch { setDecisionNeedsCheck(true); setPreview(null); setConfirmed(false); setError("The decision could not be confirmed. Refresh and inspect the recorded status before making any further decision."); }
  }
  function startUndo(row: ReceiptCorrectionRow) {
    invalidate(); setUndo(row); setAmount(""); setReason(""); setEvidence(""); setEntryId(row.targetLedgerEntryId!);
    setSource({ id: row.targetAccountId, accountNumber: row.targetAccountNumber, customerName: "", facilityId: row.facilityId });
    setTarget({ id: row.sourceAccountId, accountNumber: row.sourceAccountNumber, customerName: "", facilityId: row.facilityId });
    setMessage("Prepare an undo of this retained allocation. Independent approval is required; the original payment is retained.");
  }
  const locked = readBusy || writeBusy || !!uncertain || decisionNeedsCheck || !data;
  const accountChoices = (selected: AccountChoice | null) => selected && !data?.accounts.some(account => account.id === selected.id) ? [selected, ...(data?.accounts ?? [])] : data?.accounts ?? [];

  return <div className={styles.workspace}>
    <PageHeader eyebrow={training ? "STAFF TRAINING" : "FINANCE REVIEW"} title={training ? "Receipt correction training" : "Receipt allocation corrections"} description={training ? "Practise account selection, preview and a saved training request with sample data." : "Review an existing receipt, request an allocation correction and retain its independent decision."} />
    <p className={styles.notice}>{training ? "TRAINING ONLY: two sample accounts and a R200 sample receipt per permitted store. No live tenancy, money, ledger, financial approval, provider or access change. Training requests cannot be approved or posted." : receiptReallocationNotice}</p>
    <p><a className="button button-secondary" href={training ? "/adjustments/receipt-corrections" : "/adjustments/receipt-corrections/training"}>{training ? "Return to live receipt corrections" : "Practise with training accounts"}</a></p>
    <form className={styles.filters} onSubmit={event => { event.preventDefault(); appliedSearch.current = search; invalidate(); void load(); }}>
      <label>Store<select aria-label="Store" value={facilityId} disabled={writeBusy || !!uncertain} onChange={event => { setFacilityId(event.target.value); setSource(null); setTarget(null); setEntryId(""); setUndo(null); invalidate(); }}><option value="">All permitted stores</option>{data?.facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
      <label>Find an account<input value={search} maxLength={200} disabled={writeBusy || !!uncertain} onChange={event => setSearch(event.target.value)} placeholder="Customer or account reference" /></label>
      <button className="button button-secondary" disabled={readBusy || writeBusy || !!uncertain}>Search accounts</button>
      <button type="button" className="button button-secondary" disabled={readBusy || writeBusy} onClick={() => { invalidate(); void load(); }}>Refresh recorded state</button>
    </form>
    {readError && <p role="alert" className={styles.error}>{readError}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {readBusy && <p role="status">Loading scoped receipt records…</p>}
    {uncertain && <div className={styles.notice}><p>The pending request is locked so its saved details cannot change.</p><button type="button" className="button button-secondary" disabled={readBusy || writeBusy || !data?.capabilities.canRequest} onClick={() => void submit(uncertain)}>Retry exactly the same request</button></div>}
    {data && !readBusy && <p role="status">{data.accounts.length ? `${data.accounts.length} matching ${training ? "training " : ""}accounts. Choose a Source account below; clear the search to see other destinations.` : training ? "No training accounts match. Clear the search or select another permitted store." : "No tenancy accounts match this search and store. Customer enquiries and bookings without a tenancy account are not included. Clear the search or use training accounts."}</p>}
    {data?.accountsLimited && <p className={styles.notice}>More matching accounts exist. Narrow the store or account search to find another account.</p>}
    {data?.capabilities.canRequest ? <section className={styles.panel}>
      <div className={styles.sectionHeading}><h2>{undo ? "Prepare an allocation undo" : (training ? "Practise a receipt allocation" : "Request a receipt allocation correction")}</h2>{undo && <button type="button" className="button button-secondary" disabled={locked} onClick={() => { setUndo(null); setSource(null); setTarget(null); setEntryId(""); invalidate(); }}>Back to a new allocation</button>}</div>
      <form onSubmit={event => { event.preventDefault(); void prepare(); }}><fieldset disabled={locked} className={styles.fieldset}>
        <div className={styles.grid}>
          <label>Source account<select aria-label="Source account" value={source?.id ?? ""} disabled={!!undo} required onChange={event => { setSource(data.accounts.find(account => account.id === event.target.value) ?? null); setTarget(null); setEntryId(""); invalidate(); }}><option value="">Choose the current receipt account</option>{accountChoices(source).map(account => <option key={account.id} value={account.id}>{account.accountNumber} · {account.customerName}</option>)}</select></label>
          <label>Destination account<select aria-label="Destination account" value={target?.id ?? ""} disabled={!source || !!undo} required onChange={event => { setTarget(data.accounts.find(account => account.id === event.target.value) ?? null); invalidate(); }}><option value="">Choose an account in the same store</option>{accountChoices(target).filter(account => account.id !== source?.id && account.facilityId === source?.facilityId).map(account => <option key={account.id} value={account.id}>{account.accountNumber} · {account.customerName}</option>)}</select></label>
          <label className={styles.wide}>Verified receipt position<select aria-label="Verified receipt position" value={entryId} disabled={!source || !!undo} required onChange={event => { setEntryId(event.target.value); invalidate(); }}><option value="">Choose the retained receipt</option>{undo && !data.receipts.some(receipt => receipt.entryId === entryId) && <option value={entryId}>Original allocation receipt · load more to review availability</option>}{data.receipts.map(receipt => <option key={receipt.entryId} value={receipt.entryId}>{receipt.paymentReference} · {zar(receipt.remaining)} available · {formatSouthAfricaDateTime(receipt.recordedAt)} SAST</option>)}</select></label>
          <label>Amount in rand<input value={amount} inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?" required maxLength={15} onChange={event => { setAmount(event.target.value); invalidate(); }} /></label>
          <label>Source evidence reference<input value={evidence} required minLength={5} maxLength={200} onChange={event => { setEvidence(event.target.value); invalidate(); }} /></label>
          <label className={styles.wide}>Correction reason<textarea value={reason} required minLength={10} maxLength={500} rows={3} onChange={event => { setReason(event.target.value); invalidate(); }} /></label>
        </div>
        {source && !data.receipts.length && <p>{data.nextReceiptCursor ? "No eligible verified receipts on this page. Load more receipts to check older entries." : "No available verified receipts are shown for this account. Refresh or refer the source evidence for finance review."}</p>}
        {source && data.nextReceiptCursor && <button type="button" className="button button-secondary" onClick={() => { invalidate(); void load(undefined, data.nextReceiptCursor!); }}>Load more receipts</button>}
        <button className="button button-secondary" disabled={!source || !target || !entryId}>Preview account changes</button>
      </fieldset></form>
      {preview && <section className={styles.preview} aria-label="Correction preview"><h3>Check the exact account changes</h3><div className={styles.grid}>
        <div><h4>Source · {preview.value.source.accountNumber}</h4><p>{zar(preview.value.source.balance)} → {zar(preview.value.sourceBalanceAfter)}</p></div>
        <div><h4>Destination · {preview.value.target.accountNumber}</h4><p>{zar(preview.value.target.balance)} → {zar(preview.value.targetBalanceAfter)}</p></div>
      </div><p>Allocation amount: <strong>{zar(preview.value.amount)}</strong> · Remaining on source receipt: {zar(preview.value.sourceReceiptRemaining)}</p><p>{preview.value.notice}</p><label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)} />I checked the source receipt, both accounts and this amount.</label><button type="button" className="button button-primary" disabled={locked || !confirmed} onClick={() => void submit()}>{training ? "Save training request" : "Submit for independent review"}</button></section>}
    </section> : data && <p className={styles.notice}>Your role can review the permitted history. Creating a correction requires separate permission.</p>}
    {data && <section className={styles.panel}><h2>{training ? "Saved training requests" : "Retained requests and decisions"}</h2><p>{training ? "Newest first · SAST. Training requests remain separate from financial approval and posting. Cancel a completed practice request to tidy up." : "Newest first · SAST. A posted correction reallocates existing cash; it does not prove a new bank settlement."}</p>
      {!data.requests.length && <p>No correction requests match this view.</p>}
      <div className={styles.history}>{data.requests.map(row => <CorrectionCard key={`${row.id}:${row.revision}:${generation}`} row={row} data={data} training={training} locked={locked} onDecide={decide} onUndo={startUndo} />)}</div>
      {data.nextCursor && <button type="button" className="button button-secondary" disabled={locked} onClick={() => { invalidate(); void load(data.nextCursor!); }}>Load older requests</button>}
    </section>}
  </div>;
}

function CorrectionCard({ row, data, training, locked, onDecide, onUndo }: { row: ReceiptCorrectionRow; data: ReceiptCorrectionWorkspace; training: boolean; locked: boolean; onDecide: (row: ReceiptCorrectionRow, decision: "approve" | "reject" | "cancel", reference: string) => Promise<void>; onUndo: (row: ReceiptCorrectionRow) => void }) {
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const own = row.requestedById === data.userId;
  const review = !training && data.capabilities.canApprove && !own;
  const pending = row.status === "PENDING_APPROVAL";
  const ready = !locked && confirmed && reference.trim().length >= 5;
  return <article className={styles.card}>
    <div className={styles.sectionHeading}><h3>{row.operation === "UNDO" ? "Allocation undo" : "Receipt allocation"} · {zar(row.amount)}</h3><span className={styles.status}>{training && row.status === "PENDING_APPROVAL" ? "TRAINING SAVED" : row.status.replaceAll("_", " ")}</span></div>
    <p><strong>{row.sourceAccountNumber}</strong> → <strong>{row.targetAccountNumber}</strong> · {data.facilities.find(facility => facility.id === row.facilityId)?.name ?? "Permitted store"}</p>
    <p>{formatSouthAfricaDateTime(row.createdAt)} SAST · {row.requestedByName || "Recorded staff member"}</p><details className={styles.decision}><summary>View source and decision history</summary><p>{row.reason}</p><p>Source evidence: {row.evidenceReference}</p>
    {row.retainedPreview ? <div className={styles.retained}><h4>At submission</h4><div className={styles.grid}><p>Source balance: {zar(row.retainedPreview.sourceBalance)} → {zar(row.retainedPreview.sourceBalanceAfter)}</p><p>Destination balance: {zar(row.retainedPreview.targetBalance)} → {zar(row.retainedPreview.targetBalanceAfter)}</p></div><p>Remaining on source receipt: {zar(row.retainedPreview.sourceReceiptRemaining)}</p>{row.retainedPreview.paymentReference && <p>Original internal receipt reference: {row.retainedPreview.paymentReference}</p>}<p>{training ? "Retained sample preview only. No live balances have changed and this training request cannot be approved or posted." : "Retained submission evidence. Approval rechecks the current source; this reference is not bank settlement proof."}</p></div> : <p className={styles.notice}>The retained submission preview is unavailable. Posting approval and undo preparation are held for source review; the requester&apos;s evidence reference is not a substitute.</p>}
    {row.reviewReference && <p>Decision reference: {row.reviewReference}</p>}{row.postedAt && <p>Posted {formatSouthAfricaDateTime(row.postedAt)} SAST</p>}
    <div className={styles.actions}>{row.sourceDocumentHref && <a className="button button-secondary" href={row.sourceDocumentHref}>Source correction document</a>}{row.targetDocumentHref && <a className="button button-secondary" href={row.targetDocumentHref}>Destination correction document</a>}</div>
    {pending && own && <p>{training ? "Training has no financial approval step. You can cancel your practice request below." : "A different authorised colleague must approve or reject your request."}</p>}
    {pending && (review || own && data.capabilities.canRequest) && <details className={styles.decision}><summary>{review ? "Review decision options" : "Cancellation options"}</summary><fieldset disabled={locked} className={styles.fieldset}><label>Independent review or cancellation reference<input value={reference} minLength={5} maxLength={200} onChange={event => { setReference(event.target.value); setConfirmed(false); }} /></label><label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I checked this correction and its retained source evidence.</label><div className={styles.actions}>{review && <><button type="button" className="button button-primary" disabled={!ready || !row.retainedPreview} onClick={() => void onDecide(row, "approve", reference.trim())}>Independently approve and post</button><button type="button" className="button button-secondary" disabled={!ready} onClick={() => void onDecide(row, "reject", reference.trim())}>Reject request</button></>}{own && data.capabilities.canRequest && <button type="button" className="button button-secondary" disabled={!ready} onClick={() => void onDecide(row, "cancel", reference.trim())}>Cancel my request</button>}</div></fieldset></details>}
    {row.status === "POSTED" && row.operation === "MOVE" && row.targetLedgerEntryId && data.capabilities.canRequest && <button type="button" className="button button-secondary" disabled={locked || !row.retainedPreview} onClick={() => onUndo(row)}>Prepare an undo request</button>}</details>
  </article>;
}

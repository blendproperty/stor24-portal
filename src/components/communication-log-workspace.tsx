"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { communicationFiltersSchema, communicationLogReadSchema, emptyCommunicationFilters, type CommunicationFilters, type CommunicationLogRead } from "@/lib/communication-log-query";
import { formatSouthAfricaDateTime } from "@/lib/south-africa-time";
import { StatusPill } from "./status-pill";
import { WhatsAppRetryButton } from "./whatsapp-retry-button";
import styles from "./communication-log-workspace.module.css";

export function CommunicationLogWorkspace() {
  const [draft, setDraft] = useState<CommunicationFilters>(emptyCommunicationFilters);
  const applied = useRef<CommunicationFilters>(emptyCommunicationFilters);
  const [data, setData] = useState<CommunicationLogRead | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const snapshot = useRef<string | null>(null);
  const load = useCallback(async (filters: CommunicationFilters, cursor = "") => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    const expectedSnapshot = cursor ? snapshot.current : null;
    if (!cursor) { applied.current = filters; snapshot.current = null; }
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => !!value));
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/v1/communications/logs?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw Error(response.status === 401 ? "Sign in again to read communications." : response.status === 403 ? "Communications are unavailable for your current store access." : response.status === 422 || response.status === 404 ? "The message page no longer matches the filters or recorded source. Refresh messages to start again." : "Message history is unavailable. Refresh messages to try again.");
      const parsed = communicationLogReadSchema.safeParse(await response.json());
      if (!parsed.success || JSON.stringify(parsed.data.data.filters) !== JSON.stringify(filters) || cursor && parsed.data.data.snapshotAt !== expectedSnapshot) throw Error("Message history could not be verified. Refresh messages before continuing.");
      if (request.current !== controller || controller.signal.aborted) return;
      const result = parsed.data.data;
      applied.current = filters; snapshot.current = result.snapshotAt;
      setData(previous => cursor && previous && previous.snapshotAt === result.snapshotAt ? { ...result, rows: [...previous.rows, ...result.rows.filter(row => !previous.rows.some(existing => existing.id === row.id))] } : result);
    } catch (failure) {
      if (request.current === controller) { setData(null); snapshot.current = null; setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Message history timed out. Refresh messages to try again."); }
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(emptyCommunicationFilters), 0); return () => { clearTimeout(timer); request.current?.abort(); request.current = null; }; }, [load]);
  function apply() {
    const parsed = communicationFiltersSchema.safeParse(draft);
    if (!parsed.success) { setError("Choose valid filters. The from date must be on or before the to date; use a customer search of up to 200 characters."); return; }
    setDraft(parsed.data); void load(parsed.data);
  }
  function edit(key: keyof CommunicationFilters, value: string) { setDraft(previous => ({ ...previous, [key]: value })); }
  return <section className={styles.workspace} aria-label="Message delivery history">
    <div className={styles.heading}><div><h2>Message delivery history</h2><p>Find customer communications across older recorded pages. Open customer history for available message text and PDF, CSV or Excel downloads.</p></div><button type="button" className="button button-secondary" disabled={busy} onClick={() => void load(applied.current)}>Refresh messages</button></div>
    <form className={styles.filters} onSubmit={event => { event.preventDefault(); apply(); }}>
      <label className={styles.customer}>Find customer<input aria-label="Find customer" value={draft.search} maxLength={200} placeholder="Name, company, email, phone or reference" onChange={event => edit("search", event.target.value)} /></label>
      <label>Store<select aria-label="Store" value={draft.facilityId} onChange={event => edit("facilityId", event.target.value)}><option value="">All permitted stores</option>{data?.facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
      <label>Channel<select aria-label="Communication channel" value={draft.channel} onChange={event => edit("channel", event.target.value)}><option value="">All channels</option><option value="EMAIL">Email</option><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></select></label>
      <label>Recorded send status<select aria-label="Recorded send status" value={draft.status} onChange={event => edit("status", event.target.value)}><option value="">All statuses</option>{["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "DEAD_LETTER"].map(status => <option key={status} value={status}>{status.toLowerCase().replaceAll("_", " ")}</option>)}</select></label>
      <label>From date (SAST)<input aria-label="From date (SAST)" type="date" value={draft.from} onChange={event => edit("from", event.target.value)} /></label>
      <label>To date (SAST)<input aria-label="To date (SAST)" type="date" value={draft.to} onChange={event => edit("to", event.target.value)} /></label>
      <div className={styles.actions}><button className="button button-primary" disabled={busy}>Apply filters</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => { setDraft(emptyCommunicationFilters); void load(emptyCommunicationFilters); }}>Clear filters</button></div>
    </form>
    <p className={styles.help}>Dates include the complete selected South African days and use the logged event time. Filter edits apply when you select Apply filters. Sent means provider acceptance; delivered/read needs recorded confirmation. External conversations or missing old message content are not reconstructed.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {busy && <p role="status">Loading recorded messages…</p>}
    {!data && !busy && <div className={styles.unavailable}><strong>Message history unavailable</strong><p>A failed read is not an empty message history.</p></div>}
    {data && !busy && <><div className={styles.summary} aria-label="Loaded message summary"><div><span>Loaded messages</span><strong>{data.rows.length}</strong></div><div><span>Awaiting confirmation</span><strong>{data.rows.filter(row => ["PENDING", "PROCESSING"].includes(row.status)).length}</strong></div><div><span>Delivered / read</span><strong>{data.rows.filter(row => row.deliveredAt || row.readAt).length}</strong></div><div><span>Needs review</span><strong>{data.rows.filter(row => ["FAILED", "DEAD_LETTER"].includes(row.status)).length}</strong></div></div>
      <p className={styles.help}>Counts cover the loaded results. Logged-time cutoff: {formatSouthAfricaDateTime(data.snapshotAt)} SAST. Refresh to include newly logged messages and current outcomes.</p>
      {data.rows.length ? <div className={styles.tableWrap}><table><caption className={styles.caption}>Recorded communication attempts</caption><thead><tr><th>Customer</th><th>Store</th><th>Channel / message</th><th>Direction</th><th>Recorded outcome</th><th>Logged (SAST)</th><th>Review</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}>
        <td><span className={styles.mobileLabel}>Customer</span><strong>{row.customerName}</strong>{row.customerId && row.canOpenCustomer && <a href={`/tenants?customer=${encodeURIComponent(row.customerId)}`}>Customer history</a>}</td>
        <td><span className={styles.mobileLabel}>Store</span>{row.facilityName}</td><td><span className={styles.mobileLabel}>Channel / message</span>{row.channel}<small>{row.messageType?.replaceAll("_", " ") ?? "Recorded communication"}</small></td>
        <td><span className={styles.mobileLabel}>Direction</span>{row.direction}</td>
        <td><span className={styles.mobileLabel}>Recorded outcome</span><StatusPill tone={row.status === "FAILED" || row.status === "DEAD_LETTER" ? "warning" : row.deliveredAt || row.readAt ? "positive" : "neutral"}>{row.status === "FAILED" || row.status === "DEAD_LETTER" ? row.status : row.readAt ? "READ" : row.deliveredAt ? "DELIVERED" : row.sentAt ? "SENT" : row.status}</StatusPill><small>Recorded: {row.status}</small>{row.failureCode && <small>{row.failureCode}</small>}</td>
        <td><span className={styles.mobileLabel}>Logged (SAST)</span>{formatSouthAfricaDateTime(row.queuedAt)}</td>
        <td><span className={styles.mobileLabel}>Review</span>{row.canRetryWhatsApp ? <WhatsAppRetryButton logId={row.id} /> : ["FAILED", "DEAD_LETTER"].includes(row.status) ? "Review delivery before another send" : ["PENDING", "PROCESSING"].includes(row.status) ? "Awaiting confirmation" : "—"}</td>
      </tr>)}</tbody></table></div> : <div className={styles.unavailable}><strong>No recorded messages match the applied filters</strong><p>Try a different customer, date range, channel or recorded status.</p></div>}
      {data.nextCursor && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void load(applied.current, data.nextCursor!)}>Load older messages</button>}
    </>}
  </section>;
}

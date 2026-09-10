"use client";

import { useState } from "react";
import Link from "next/link";
import { formatSouthAfricaDate, southAfricaDateKey } from "@/lib/south-africa-time";

type Statement = { accountNumber: string; customerName: string; facilityName: string; currency: string; from: string; to: string; generatedAt: string; openingBalance: string; closingBalance: string; rows: { id: string; date: string; description: string; type: string; debit: string; credit: string; balance: string }[] };

export function AccountStatementWorkspace({ accountId }: { accountId: string }) {
  const today = southAfricaDateKey(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function emailStatement() {
    if (!statement || !window.confirm("Email a secure statement link to this customer's verified email address?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/statement/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: statement.from, to: statement.to }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "The email could not be sent.");
      setNotice(result.message);
    } catch (err) { setError(err instanceof Error ? err.message : "The email could not be sent."); }
    finally { setBusy(false); }
  }
  const money = (value: string) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: statement?.currency ?? "ZAR" }).format(Number(value));
  async function load() {
    setBusy(true); setError(""); setStatement(null);
    try {
      const response = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/statement?${new URLSearchParams({ from, to })}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Statement could not be loaded.");
      setStatement(payload.data);
    } catch (err) { setError(err instanceof Error ? err.message : "Statement could not be loaded."); }
    finally { setBusy(false); }
  }
  return <section className="statement-workspace">
    <div className="statement-controls">
      <Link href={`/operations/accounts?accountId=${encodeURIComponent(accountId)}`}>← Back to accounts</Link>
      <h1>Everything accounted for.</h1>
      <p>View or download a statement without creating charges. Email delivery requires a separate confirmation and uses the customer’s verified email.</p>
      <form onSubmit={event => { event.preventDefault(); void load(); }} className="statement-filters">
        <label>From<input type="date" disabled={busy} value={from} required onChange={event => { setFrom(event.target.value); setStatement(null); }} /></label>
        <label>To<input type="date" disabled={busy} value={to} min={from} required onChange={event => { setTo(event.target.value); setStatement(null); }} /></label>
        <button className="button" disabled={busy}>{busy ? "Preparing…" : "View statement"}</button>
        {statement && <a className="button button-secondary" href={`/api/v1/accounts/${encodeURIComponent(accountId)}/statement?${new URLSearchParams({ from: statement.from, to: statement.to, format: "pdf" })}`}>Download PDF</a>}
        {statement && <button type="button" className="button button-secondary" onClick={() => window.print()}>Print</button>}
        {statement && <button type="button" disabled={busy} className="button button-secondary" onClick={() => void emailStatement()}>Email secure link</button>}
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
    {statement && <article className="statement-paper">
      <header><strong className="statement-brand">STOR24</strong><span>ACCOUNT STATEMENT</span></header>
      <div className="statement-details"><div><h2>{statement.customerName}</h2><p>{statement.facilityName}<br />Account {statement.accountNumber}</p></div><div><p>{formatSouthAfricaDate(`${statement.from}T12:00:00+02:00`)} – {formatSouthAfricaDate(`${statement.to}T12:00:00+02:00`)}</p><p>Prepared {formatSouthAfricaDate(statement.generatedAt)} · {statement.currency}</p></div></div>
      <div className="statement-balances"><div>Opening balance<strong>{money(statement.openingBalance)}</strong></div><div>{Number(statement.closingBalance) < 0 ? "Closing credit balance" : "Closing balance"}<strong>{money(statement.closingBalance)}</strong></div></div>
      <div className="statement-table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>{statement.rows.map(row => <tr key={row.id}><td>{formatSouthAfricaDate(row.date)}</td><td>{row.description}<small>{row.type.replaceAll("_", " ")}</small></td><td>{Number(row.debit) ? money(row.debit) : "—"}</td><td>{Number(row.credit) ? money(row.credit) : "—"}</td><td>{money(row.balance)}</td></tr>)}</tbody></table></div>
      {!statement.rows.length && <p>No transactions recorded in this period.</p>}
      <footer><p>This statement reflects transactions recorded in the STOR24 ledger, not a tax invoice or confirmation of bank settlement. Pending payments and booking estimates are not included. Historical imports and opening balances must be reconciled before customer issue.</p><strong>Safe space. Smart storage. STOR24.</strong></footer>
    </article>}
    <style>{`
      .statement-workspace{max-width:1100px;margin:auto;padding:24px;color:#071411}.statement-controls h1{font-size:32px;margin:22px 0 8px}.statement-filters{display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin:24px 0}.statement-filters label{display:grid;gap:8px;font-weight:600}.statement-filters input{padding:12px;border:1px solid #bdc9c3;border-radius:8px;font:inherit;background:white}.statement-paper{background:white;border:1px solid #dfe3df;border-top:6px solid #ff5a0a;border-radius:12px;padding:32px}.statement-paper header,.statement-details,.statement-balances{display:flex;justify-content:space-between;gap:24px}.statement-paper header{align-items:center;letter-spacing:1px;font-size:12px}.statement-brand{font-size:30px;letter-spacing:-1px}.statement-details{margin:28px 0}.statement-details h2{font-size:22px;margin:0}.statement-details p{line-height:1.6}.statement-balances{padding:20px;background:#f5f3ea;border-radius:8px;margin-bottom:24px}.statement-balances strong{display:block;font-size:26px;margin-top:8px}.statement-table-scroll{overflow-x:auto}.statement-paper table{border-collapse:collapse;width:100%;font-size:14px}.statement-paper th,.statement-paper td{padding:12px 8px;border-bottom:1px solid #dfe3df;text-align:right;vertical-align:top}.statement-paper th:nth-child(-n+2),.statement-paper td:nth-child(-n+2){text-align:left}.statement-paper td:not(:nth-child(2)){white-space:nowrap}.statement-paper small{display:block;color:#52615b;font-size:10px;margin-top:4px}.statement-paper footer{margin-top:26px;font-size:12px;line-height:1.6;color:#52615b}@media(max-width:600px){.statement-workspace{padding:12px}.statement-paper{padding:16px}.statement-details{flex-direction:column;gap:0}.statement-balances strong{font-size:21px}}@media print{body *{visibility:hidden}.statement-paper,.statement-paper *{visibility:visible}.statement-paper{position:absolute;left:0;top:0;width:100%;border-radius:0;border:0;padding:12mm;font-size:10pt}.statement-controls{display:none}.statement-table-scroll{overflow:visible}.statement-paper tr{break-inside:avoid}.statement-paper thead{display:table-header-group}.statement-paper footer{break-inside:avoid}@page{size:A4;margin:12mm}}
    `}</style>
  </section>;
}

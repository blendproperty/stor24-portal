"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, Download, FileText, LogOut, Mail, ShieldCheck } from "lucide-react";
import { formatSouthAfricaDate, southAfricaDateKey } from "@/lib/south-africa-time";
import type { AccountStatementData } from "@/lib/finance/statement-data";
import { preferredTenantAccount, tenantAccountLabel } from "@/lib/tenant-account-presentation";

type PortalData = {
  accounts: { id: string; accountNumber: string; balance: string; currency: string; tenancy: null | { status: string; facility: { name: string }; occupancies: { unit: { number: string } }[] } }[];
  documents: { id: string; type: string; createdAt: string }[];
  agreements: { id: string; signedAt: string; reservation: { publicReference: string | null } }[];
  payments: { id: string; amount: string; currency: string; processedAt: string | null; createdAt: string; account: { accountNumber: string } }[];
  expiresAt: string;
};
const currency = (amount: string, code = "ZAR") => new Intl.NumberFormat("en-ZA", { style: "currency", currency: code }).format(Number(amount));

export function TenantPortal({ organisation, initialAccount, initialFrom, initialTo }: { organisation: string; initialAccount?: string; initialFrom?: string; initialTo?: string }) {
  const today = southAfricaDateKey(new Date());
  const [data, setData] = useState<PortalData | null>(null), [checking, setChecking] = useState(true);
  const [email, setEmail] = useState(""), [code, setCode] = useState(""), [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [accountId, setAccountId] = useState(initialAccount ?? "");
  const [from, setFrom] = useState(initialFrom && /^\d{4}-\d{2}-\d{2}$/.test(initialFrom) ? initialFrom : `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(initialTo && /^\d{4}-\d{2}-\d{2}$/.test(initialTo) ? initialTo : today);
  const [statement, setStatement] = useState<AccountStatementData | null>(null);
  const statementRequest = useRef(0);
  function clearStatement() { statementRequest.current++; setStatement(null); }
  async function loadStatement(url: string) {
    const version = ++statementRequest.current;
    const result = await request(url);
    if (version === statementRequest.current) setStatement(result.data);
  }
  async function request(url: string, body?: unknown) {
    const response = await fetch(url, { cache: "no-store", ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    if (!response.ok) { if (response.status === 401 && !url.includes("/auth/")) { setData(null); setStatement(null); setCodeSent(false); } throw new Error(payload.error ?? "Something went wrong. Please try again."); }
    return payload;
  }
  useEffect(() => {
    let disposed = false;
    fetch("/api/tenant/accounts", { cache: "no-store" }).then(async response => {
      if (response.status === 401) return;
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Your account is temporarily unavailable.");
      if (!disposed) { setData(payload.data); setAccountId(current => preferredTenantAccount(payload.data.accounts, current)); }
    }).catch(() => { if (!disposed) setError("We could not load your account. Please try again shortly."); }).finally(() => { if (!disposed) setChecking(false); });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => { statementRequest.current++; setData(null); setStatement(null); setCodeSent(false); setNotice("For your security, your session has ended. Sign in again when you are ready."); }, Math.max(0, new Date(data.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [data]);
  async function act(work: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await work(); } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); } finally { setBusy(false); } }
  const statementUrl = `/api/tenant/accounts/${encodeURIComponent(accountId)}/statement?${new URLSearchParams({ from, to })}`;
  const selectedAccount = data?.accounts.find(account => account.id === accountId);
  return <main className="tenant-portal">
    <header className="tenant-header"><Image src="/brand/stor24-logo-official-email-20260909.svg" width={183} height={48} alt="STOR24" priority unoptimized /><span>MY STOR24</span>{data && <button onClick={() => void act(async () => { await request("/api/tenant/auth/logout", {}); setData(null); setStatement(null); setCodeSent(false); setCode(""); })} disabled={busy}><LogOut size={16} /> Sign out</button>}</header>
    <div className="tenant-body">
      {checking ? <p role="status">Opening your secure space…</p> : !data ? <div className="tenant-entry">
        <section className="tenant-entry-story" aria-label="Welcome to My STOR24">
          <div className="tenant-entry-copy"><span className="tenant-eyebrow">LIFE HAPPENS. WE’VE GOT ROOM.</span><h1>Your space.<br /><span>Less admin.</span><br />More living.</h1><p>Everything for your STOR24 account, neatly packed into one place.</p></div>
          <Image className="tenant-entry-art" src="/brand/stor24-storage-unit-hero.png" width={1536} height={1024} alt="STOR24 storage unit with an orange door and neatly packed moving boxes" priority />
          <div className="tenant-entry-caption"><span>SPACE FOR LIFE IN MOTION.</span><span>MY STOR24 ↗</span></div>
        </section>
        <section className="tenant-login tenant-card">
        <span className="tenant-eyebrow">YOUR PERSONAL STOR24 SPACE</span><h2>{codeSent ? "Check your inbox." : "Welcome back."}</h2><p>{codeSent ? "Pop in your six-digit code and you’re in." : "Let’s get you sorted. Sign in to find your statements, receipts and agreements."}</p>
        {!organisation ? <p role="alert">Please use the My STOR24 link supplied by your store. It identifies the organisation your account belongs to.</p> : <form onSubmit={event => { event.preventDefault(); void act(async () => {
          if (!codeSent) { const result = await request("/api/tenant/auth/start", { organisation, email }); setNotice(result.message); setCodeSent(true); }
          else { await request("/api/tenant/auth/verify", { code }); const result = await request("/api/tenant/accounts"); setData(result.data); setAccountId(preferredTenantAccount(result.data.accounts, initialAccount)); setCode(""); }
        }); }}>
          <label>Email on your STOR24 account<input type="email" autoComplete="email" required value={email} disabled={codeSent} onChange={event => setEmail(event.target.value)} /></label>
          {codeSent && <label>Your six-digit code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value)} /></label>}
          <button className="tenant-primary" disabled={busy}>{busy ? "One moment…" : codeSent ? "Open my account" : "Email me a sign-in code"}<ArrowRight size={18} /></button>
          {codeSent && <button type="button" disabled={busy} onClick={() => { setCodeSent(false); setCode(""); setNotice(""); }}>Use another email / request a new code</button>}
        </form>}
        <p className="tenant-security"><ShieldCheck size={17} /> Your code expires in 10 minutes. Never share it.</p>
        <div className="tenant-entry-benefits"><span><FileText size={18} /> Statements, without the paperwork.</span><span><Download size={18} /> Your documents, ready when you are.</span><span><ShieldCheck size={18} /> Your account. Your eyes only.</span></div>
      </section></div> : <>
        <div className="tenant-welcome"><span className="tenant-eyebrow">Welcome to your space</span><h1>Your space. Sorted.</h1><p>Your account, statements and documents. A little less admin.</p></div>
        {selectedAccount && <section className="tenant-account-summary" aria-label="Selected account">
          <div className="tenant-account-main"><span className="tenant-eyebrow">YOUR STOR24 ACCOUNT</span><h2>{tenantAccountLabel(selectedAccount)}</h2><p className="tenant-account-reference">Account reference · {selectedAccount.accountNumber}</p>
            {data.accounts.length > 1 && <label className="tenant-account-switch">Switch account <span>{data.accounts.length} linked accounts · all records retained</span><select value={accountId} disabled={busy} onChange={event => { setAccountId(event.target.value); clearStatement(); setNotice(""); setError(""); }}>{data.accounts.map((account, index) => <option key={account.id} value={account.id}>{index + 1}. {tenantAccountLabel(account)} · {account.accountNumber}</option>)}</select></label>}
          </div>
          <div className="tenant-balance-panel"><span>{Number(selectedAccount.balance) < 0 ? "Account credit" : Number(selectedAccount.balance) > 0 ? "Recorded balance due" : "Account balance"}</span><strong>{currency(String(Math.abs(Number(selectedAccount.balance))), selectedAccount.currency)}</strong><p>{Number(selectedAccount.balance) < 0 ? "Credit recorded on this account." : "Your current recorded account balance."}</p><a href="#tenant-statements">View statements <ArrowRight size={16} /></a></div>
        </section>}
        {!data.accounts.length && <p>No billing account is available yet. Your signed agreements, if available, are below.</p>}
        {!!accountId && <section className="tenant-card" id="tenant-statements"><h2>Your statements</h2><p>For the selected account. Choose a period to view, download or email a secure link.</p><form className="tenant-filters" onSubmit={event => { event.preventDefault(); void act(() => loadStatement(statementUrl)); }}><label>From<input type="date" disabled={busy} value={from} onChange={event => { setFrom(event.target.value); clearStatement(); }} required /></label><label>To<input type="date" disabled={busy} min={from} value={to} onChange={event => { setTo(event.target.value); clearStatement(); }} required /></label><button className="tenant-primary" disabled={busy}>View statement</button></form>
          {statement && <><div className="tenant-downloads"><a href={`${statementUrl}&format=pdf`}><Download size={17} /> Download PDF</a><button disabled={busy} onClick={() => void act(async () => setNotice((await request(`/api/tenant/accounts/${encodeURIComponent(accountId)}/statement`, { from, to })).message))}><Mail size={17} /> Email secure link to me</button></div><p>Opening: <strong>{currency(statement.openingBalance, statement.currency)}</strong> · Closing: <strong>{currency(statement.closingBalance, statement.currency)}</strong></p><div className="tenant-table"><table><thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>{statement.rows.map(row => <tr key={row.id}><td>{formatSouthAfricaDate(row.date)}</td><td>{row.description}</td><td>{currency(row.debit, statement.currency)}</td><td>{currency(row.credit, statement.currency)}</td><td>{currency(row.balance, statement.currency)}</td></tr>)}</tbody></table></div>{!statement.rows.length && <p>No transactions in this period.</p>}</>}
          {statement && <p className="tenant-scroll-hint">Swipe the transaction table sideways to see debit, credit and balance. The PDF shows all columns together.</p>}
        </section>}
        <section className="tenant-card"><h2>Your document library</h2><p>Completed agreements, receipts and issued documents across all your linked accounts.</p><div className="tenant-document-list">
          {data.agreements.map(item => <a key={item.id} href={`/api/tenant/documents/agreement/${item.id}`}><FileText size={20} /><span>Signed agreement<small>{item.reservation.publicReference} · {formatSouthAfricaDate(item.signedAt)}</small></span><Download size={18} /></a>)}
          {data.documents.map(item => <a key={item.id} href={`/api/tenant/documents/issued/${item.id}`}><FileText size={20} /><span>{item.type.replaceAll("_", " ")}<small>{formatSouthAfricaDate(item.createdAt)} · {item.type === "LEASE_AGREEMENT" ? "PDF" : "Original issued HTML document"}</small></span><Download size={18} /></a>)}
          {data.payments.map(item => <a key={item.id} href={`/api/tenant/documents/receipt/${item.id}`}><FileText size={20} /><span>Payment receipt · {currency(item.amount, item.currency)}<small>{formatSouthAfricaDate(item.processedAt ?? item.createdAt)} · {item.account.accountNumber}</small></span><Download size={18} /></a>)}
          {!data.documents.length && !data.agreements.length && !data.payments.length && <p>No documents have been issued yet.</p>}
        </div></section>
      </>}
      {error && <p className="tenant-message tenant-error" role="alert">{error}</p>}{notice && <p className="tenant-message" role="status">{notice}</p>}
      <footer className="tenant-footer"><ShieldCheck size={16} /><span>Private by design. Sessions end after 30 minutes.<br />Need a hand? <a href="https://stor4.srv938083.hstgr.cloud/contact">Contact your STOR24 store.</a></span></footer>
    </div>
  </main>;
}

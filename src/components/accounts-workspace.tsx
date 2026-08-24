"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, CreditCard, DoorOpen, Download, FileCheck2, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type Ledger = { id: string; type: string; amount: string; description: string; effectiveAt: string };
type Payment = { id: string; amount: string; method: string; status: string; processedAt: string | null; createdAt: string };
type Account = { id: string; accountNumber: string; balance: string; currency: string; customer: { firstName: string | null; lastName: string | null; companyName: string | null; email: string | null; phone: string | null }; tenancy: { id: string; status: string; facilityId: string; facility: { name: string }; documents: { id: string; status: string; signedAt: string | null }[]; occupancies: { unit: { number: string; unitType: { name: string } }; monthlyRate: string }[] } | null; ledgerEntries: Ledger[]; payments: Payment[] };
type Facility = { id: string; name: string; units: { id: string; number: string; monthlyRate: string; unitType: { name: string } }[] };
type Data = { accounts: Account[]; facilities: Facility[] };
type Dialog = "payment" | "transfer" | "moveOut" | null;

const money = (value: string | number) => `R ${Number(value).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const customerName = (account: Account) => account.customer.companyName || [account.customer.firstName, account.customer.lastName].filter(Boolean).join(" ") || "Unnamed customer";

function generateReference(accountNumber: string) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${accountNumber}-${stamp}-${suffix}`;
}

export function AccountsWorkspace({ initialAccountId, initialDocumentId }: { initialAccountId?: string; initialDocumentId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/v1/accounts", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) { setError(payload.error?.message ?? "Accounts could not be loaded."); return; } setData(payload.data); setSelectedId((current) => current || payload.data.accounts[0]?.id || ""); }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/accounts", { cache: "no-store" }).then(async (response) => ({ response, payload: await response.json() })).then(({ response, payload }) => {
      if (cancelled) return;
      if (!response.ok) setError(payload.error?.message ?? "Accounts could not be loaded.");
      else {
        setData(payload.data);
        const linkedAccount = initialAccountId
          ? payload.data.accounts.find((account: Account) => account.id === initialAccountId)
          : initialDocumentId
          ? payload.data.accounts.find((account: Account) => account.tenancy?.documents.some((document) => document.id === initialDocumentId))
          : undefined;
        setSelectedId(linkedAccount?.id || payload.data.accounts[0]?.id || "");
      }
    });
    return () => { cancelled = true; };
  }, [initialAccountId, initialDocumentId]);
  const selected = data?.accounts.find((account) => account.id === selectedId) ?? null;
  const visible = useMemo(() => data?.accounts.filter((account) => `${account.accountNumber} ${customerName(account)} ${account.tenancy?.occupancies[0]?.unit.number ?? ""}`.toLowerCase().includes(search.toLowerCase())) ?? [], [data, search]);
  const active = data?.accounts.filter((account) => ["ACTIVE", "NOTICE_GIVEN"].includes(account.tenancy?.status ?? "")).length ?? 0;
  const outstanding = data?.accounts.reduce((sum, account) => sum + Math.max(0, Number(account.balance)), 0) ?? 0;
  const paidToday = data?.accounts.flatMap((account) => account.payments).filter((payment) => payment.status === "SUCCEEDED" && new Date(payment.processedAt ?? payment.createdAt).toDateString() === new Date().toDateString()).reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0;

  async function submitPayment(formData: FormData) { await submit("/api/v1/accounts", { accountId: selectedId, amount: Number(formData.get("amount")), method: formData.get("method"), reference: formData.get("reference") || undefined, receivedAt: new Date(String(formData.get("receivedAt"))).toISOString() }, "Payment posted."); }
  async function submitTransfer(formData: FormData) { await submit("/api/v1/leasing/workflows/transfer", { tenancyId: selected?.tenancy?.id, toUnitId: formData.get("toUnitId"), effectiveAt: new Date(String(formData.get("effectiveAt"))).toISOString(), monthlyRate: formData.get("monthlyRate") ? Number(formData.get("monthlyRate")) : undefined }, "Transfer completed."); }
  async function submitMoveOut(formData: FormData) { await submit("/api/v1/leasing/workflows/move-out", { tenancyId: selected?.tenancy?.id, movedOutAt: new Date(String(formData.get("movedOutAt"))).toISOString(), finalCharge: Number(formData.get("finalCharge") || 0), notes: formData.get("notes") || undefined }, "Move-out completed."); }
  async function submit(url: string, body: Record<string, unknown>, message: string) { setBusy(true); setError(""); setNotice(""); const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json(); setBusy(false); if (!response.ok) { setError(payload.error?.message ?? "The account action could not be completed."); return; } setDialog(null); setNotice(message); await load(); }
  const facility = data?.facilities.find((item) => item.id === selected?.tenancy?.facilityId);

  return <div className="page-stack"><PageHeader eyebrow="Operations centre" title="Accounts" description="Manage tenant balances, payments, transfers and move-outs against live store records." action={<Link href="/operations/move-in" className="button button-primary"><Plus size={16}/>Move in</Link>}/>
    {error ? <p className="form-error">{error}</p> : null}{notice ? <p className="form-success">{notice}</p> : null}
    <section className="summary-strip">{[["Active accounts", active], ["Outstanding", money(outstanding)], ["Collected today", money(paidToday)], ["Accounts", data?.accounts.length ?? 0]].map(([label,value]) => <div className="summary-cell" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <section className="accounts-layout"><aside className="panel accounts-list"><label className="toolbar-search"><Search size={16}/><input placeholder="Search account, tenant or unit" value={search} onChange={(event) => setSearch(event.target.value)}/></label>{visible.length ? visible.map((account) => <button type="button" className={selectedId === account.id ? "account-list-row active" : "account-list-row"} onClick={() => setSelectedId(account.id)} key={account.id}><span><strong>{customerName(account)}</strong><small>{account.accountNumber} · Unit {account.tenancy?.occupancies[0]?.unit.number ?? "—"}</small></span><b className={Number(account.balance) > 0 ? "balance-due" : ""}>{money(account.balance)}</b></button>) : <p className="empty-cell">No accounts found.</p>}</aside>
      <article className="panel panel-spacious account-detail">{selected ? <><div className="panel-heading"><div><p className="eyebrow">{selected.accountNumber}</p><h2>{customerName(selected)}</h2><p className="panel-subtitle">{selected.tenancy?.facility.name} · Unit {selected.tenancy?.occupancies[0]?.unit.number ?? "—"} · {selected.customer.phone || selected.customer.email || "No contact details"}</p></div><div className="account-balance"><span>Balance</span><strong>{money(selected.balance)}</strong><StatusPill tone={Number(selected.balance) > 0 ? "warning" : "positive"}>{Number(selected.balance) > 0 ? "Amount due" : "Paid"}</StatusPill></div></div>
        <div className="account-actions"><button className="button button-primary" onClick={() => { setError(""); setPaymentReference(generateReference(selected.accountNumber)); setDialog("payment"); }}><CreditCard size={16}/>Take payment</button><button className="button button-secondary" disabled={selected.tenancy?.status !== "ACTIVE"} onClick={() => { setError(""); setDialog("transfer"); }}><ArrowRightLeft size={16}/>Transfer</button><button className="button button-secondary" disabled={!selected.tenancy || !["ACTIVE","NOTICE_GIVEN"].includes(selected.tenancy.status)} onClick={() => { setError(""); setDialog("moveOut"); }}><DoorOpen size={16}/>Move out</button></div>
        <div className="account-info-grid"><div><span>Security status</span><strong>{selected.tenancy?.occupancies[0] ? "Active occupancy" : "Access closed"}</strong></div><div><span>Monthly rent</span><strong>{money(selected.tenancy?.occupancies[0]?.monthlyRate ?? 0)}</strong></div><div><span>Unit type</span><strong>{selected.tenancy?.occupancies[0]?.unit.unitType.name ?? "—"}</strong></div><div><span>Tenancy status</span><strong>{selected.tenancy?.status.replaceAll("_", " ") ?? "—"}</strong></div></div>
        {selected.tenancy?.documents.some((document) => document.status === "SIGNED") ? <div className="account-actions">{selected.tenancy.documents.filter((document) => document.status === "SIGNED").slice(0, 1).map((document) => <span className="account-actions" key={document.id}><a className="button button-secondary" href={`/api/v1/documents/${document.id}/signed`}><Download size={16}/>Completed lease</a><a className="button button-secondary" href={`/api/v1/documents/${document.id}/certificate`}><FileCheck2 size={16}/>Completion certificate</a></span>)}</div> : null}
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th></tr></thead><tbody>{selected.ledgerEntries.length ? selected.ledgerEntries.map((entry) => <tr key={entry.id}><td>{new Date(entry.effectiveAt).toLocaleDateString("en-ZA")}</td><td>{entry.description}</td><td>{entry.type}</td><td className={entry.type === "PAYMENT" ? "credit-amount" : ""}>{entry.type === "PAYMENT" ? "− " : ""}{money(entry.amount)}</td></tr>) : <tr><td colSpan={4} className="empty-cell">No account transactions.</td></tr>}</tbody></table></div></> : <p className="empty-cell">Select an account.</p>}</article>
    </section>
    {dialog && selected ? <div className="modal-backdrop"><div className="modal-card" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setDialog(null)}><X size={18}/></button><p className="eyebrow">{selected.accountNumber}</p><h2>{dialog === "payment" ? "Take payment" : dialog === "transfer" ? "Transfer unit" : "Move out"}</h2>
      {dialog === "payment" ? <form action={submitPayment} className="invite-form"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={Math.max(0, Number(selected.balance)) || ""} required/></label><label>Payment method<select name="method" defaultValue="EFT"><option value="EFT">EFT</option><option value="CARD">Card</option><option value="CASH">Cash</option><option value="BANK_DEBIT">Bank debit</option></select></label><label>Reference<input name="reference" maxLength={120} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)}/><small>Auto-generated — replace with the customer&apos;s bank/EFT reference if you have one.</small></label><label>Date received<input name="receivedAt" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/></label><ActionButtons busy={busy} close={() => setDialog(null)} label="Post payment"/></form> : null}
      {dialog === "transfer" ? <form action={submitTransfer} className="invite-form"><label>New unit<select name="toUnitId" required><option value="">Select available unit</option>{facility?.units.map((unit) => <option value={unit.id} key={unit.id}>{unit.number} · {unit.unitType.name} · {money(unit.monthlyRate)}</option>)}</select></label><label>Effective date<input name="effectiveAt" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/></label><label>Monthly rent override<input name="monthlyRate" type="number" min="0" step="0.01"/></label><ActionButtons busy={busy} close={() => setDialog(null)} label="Complete transfer"/></form> : null}
      {dialog === "moveOut" ? <form action={submitMoveOut} className="invite-form"><label>Move-out date<input name="movedOutAt" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/></label><label>Final charge<input name="finalCharge" type="number" min="0" step="0.01" defaultValue="0"/></label><label>Notes<textarea name="notes" rows={4} maxLength={2000}/></label><ActionButtons busy={busy} close={() => setDialog(null)} label="Complete move-out"/></form> : null}
    </div></div> : null}
  </div>;
}

function ActionButtons({ busy, close, label }: { busy: boolean; close: () => void; label: string }) { return <div className="form-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : label}</button></div>; }

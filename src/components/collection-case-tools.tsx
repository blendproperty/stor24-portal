"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { CollectionsWorkspaceData } from "@/lib/collections-service";
import { CustomerHistory } from "./customer-history";
import { CollectionNoticeWorkspace } from "./collection-notice-workspace";
import { CollectionPhoneWorkspace } from "./collection-phone-workspace";
import { formatSouthAfricaDate } from "@/lib/south-africa-time";

type Row = CollectionsWorkspaceData["rows"][number];
const amount = z.string().refine(v => v.trim() !== "" && Number.isFinite(Number(v)));
const accountSchema = z.object({ id: z.string(), financialReviewRequired: z.boolean().optional(), ledgerEntries: z.array(z.object({ id: z.string(), type: z.string(), description: z.string(), amount, effectiveAt: z.iso.datetime({offset:true}) })), payments: z.array(z.object({ id: z.string(), amount, status: z.string(), method: z.string(), processedAt: z.iso.datetime({offset:true}).nullable(), createdAt: z.iso.datetime({offset:true}) })) });
const money = (value: string) => new Intl.NumberFormat("en-ZA", {style:"currency",currency:"ZAR"}).format(Number(value));

export function CollectionCaseTools({ row }: { row: Row }) {
  const [tab, setTab] = useState("");
  return <div className="collection-case-tools">
    <dl className="collection-contact"><div><dt>Unit</dt><dd>{row.units?.join(", ") || "No current unit"}</dd></div><div><dt>Phone</dt><dd>{row.phone || "Not recorded"}</dd></div><div><dt>Alternate phone</dt><dd>{row.alternatePhone || "Not recorded"}</dd></div><div><dt>Email</dt><dd>{row.email || "Not recorded"}</dd></div></dl>
    <nav className="adjustment-actions" aria-label="Selected collection account actions">{[["","Case notes"],["history","Customer history"],["finance","Ledger, payments & receipts"],["email","Email"],["phone","SMS & WhatsApp"]].map(([id,label]) => <button type="button" className="button button-secondary" key={id} aria-pressed={tab===id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === "history" && row.customerId && <CustomerHistory key={row.customerId} customerId={row.customerId}/>}
    {tab === "finance" && <CollectionAccountRecords accountId={row.id}/>}
    {tab === "email" && <CollectionNoticeWorkspace key={row.id} accountId={row.id} embedded/>}
    {tab === "phone" && <CollectionPhoneWorkspace key={row.id} initialAccountId={row.id} embedded/>}
  </div>;
}

function CollectionAccountRecords({ accountId }: { accountId: string }) {
  const [account, setAccount] = useState<z.infer<typeof accountSchema> | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    void fetch(`/api/v1/accounts?accountId=${encodeURIComponent(accountId)}`, {cache:"no-store",signal:controller.signal}).then(async response => {
      if(!response.ok) throw Error(response.status===403 ? "Ledger access is required for this account." : "Account records could not be loaded.");
      const result = await response.json();
      const selected = z.array(accountSchema).parse(result.data?.accounts).find(a => a.id === accountId);
      if(!selected) throw Error("This account is unavailable or outside your access.");
      if(active) setAccount(selected);
    }).catch(e => {if(active) setError(e instanceof Error && !["ZodError","AbortError"].includes(e.name) ? e.message : "Account records could not be read. Reload to try again.");}).finally(() => clearTimeout(timeout));
    return () => {active=false;clearTimeout(timeout);controller.abort();};
  }, [accountId,retry]);
  return <section aria-label="Account financial records"><h3>Ledger, payments &amp; receipts</h3>{error ? <p role="alert">{error} <button type="button" className="button button-secondary" onClick={() => {setError("");setAccount(null);setRetry(v=>v+1);}}>Reload account records</button></p> : !account ? <p>Loading account records…</p> : <>
    {account.financialReviewRequired && <p role="status">Historical test entries require financial reconciliation. They are not cleared rent.</p>}
    <a className="button button-secondary" href={`/operations/accounts/${encodeURIComponent(accountId)}/statement`}>Account statement</a>
    <h4>Payment history</h4><p>Latest 25 payments. A receipt is available only after its posted source is verified. Paid-through dates are not inferred from the last payment.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method / status</th><th>Receipt</th></tr></thead><tbody>{account.payments.map(p=><tr key={p.id}><td>{formatSouthAfricaDate(p.processedAt || p.createdAt)}</td><td>{money(p.amount)}</td><td>{p.method} · {p.status}</td><td>{p.status==="SUCCEEDED" && !account.financialReviewRequired ? <a href={`/api/v1/accounts/${encodeURIComponent(accountId)}/receipts/${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer">View / print receipt</a> : "Unavailable pending review"}</td></tr>)}{!account.payments.length&&<tr><td colSpan={4}>No recorded payments.</td></tr>}</tbody></table></div>
    <h4>Account ledger</h4><p>Latest 50 entries; use the dated statement for earlier history.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>{account.ledgerEntries.map(e=><tr key={e.id}><td>{formatSouthAfricaDate(e.effectiveAt)}</td><td>{e.type}</td><td>{e.description}</td><td>{money(e.amount)}</td></tr>)}{!account.ledgerEntries.length&&<tr><td colSpan={4}>No account transactions.</td></tr>}</tbody></table></div>
  </>}</section>;
}

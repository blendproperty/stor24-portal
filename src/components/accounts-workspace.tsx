"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  ArrowRightLeft,
  ArrowLeft,
  ChevronRight,
  CreditCard,
  DoorOpen,
  Download,
  FileCheck2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { formatSouthAfricaDate, southAfricaDateKey } from "@/lib/south-africa-time";

type Ledger = {
  id: string;
  type: string;
  amount: string;
  description: string;
  effectiveAt: string;
};
type Payment = {
  id: string;
  amount: string;
  method: string;
  status: string;
  processedAt: string | null;
  createdAt: string;
};
type Account = {
  financialReviewRequired?: boolean;
  id: string;
  accountNumber: string;
  balance: string;
  currency: string;
  customer: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    email: string | null;
    phone: string | null;
  };
  tenancy: {
    id: string;
    status: string;
    facilityId: string;
    facility: { name: string };
    documents: { id: string; status: string; signedAt: string | null; provider?: string | null; externalId?: string | null }[];
    occupancies: {
      status: string;
      unit: { number: string; unitType: { name: string } };
      monthlyRate: string;
    }[];
  } | null;
  ledgerEntries: Ledger[];
  payments: Payment[];
};
type Facility = {
  id: string;
  name: string;
  units: {
    id: string;
    number: string;
    monthlyRate: string;
    unitType: { name: string };
  }[];
};
type Data = { accounts: Account[]; facilities: Facility[] };
const readMoney = z.string().min(1).refine(value => Number.isFinite(Number(value)));
const readDate = z.string().refine(value => Number.isFinite(Date.parse(value)));
const readUnit = z.object({ number: z.string(), unitType: z.object({ name: z.string() }) });
const accountsReadSchema = z.object({
  accounts: z.array(z.object({
    id: z.string(), accountNumber: z.string(), balance: readMoney, currency: z.string(), financialReviewRequired: z.boolean().optional(),
    customer: z.object({ firstName: z.string().nullable().optional(), lastName: z.string().nullable().optional(), companyName: z.string().nullable().optional(), email: z.string().nullable().optional(), phone: z.string().nullable().optional() }),
    tenancy: z.object({ id: z.string(), status: z.string(), facilityId: z.string(), facility: z.object({ name: z.string() }), documents: z.array(z.object({ id: z.string(), status: z.string(), signedAt: readDate.nullable(), provider: z.string().nullable().optional(), externalId: z.string().nullable().optional() })), occupancies: z.array(z.object({ status: z.string(), unit: readUnit, monthlyRate: readMoney })) }).nullable(),
    ledgerEntries: z.array(z.object({ id: z.string(), type: z.string(), amount: readMoney, description: z.string(), effectiveAt: readDate })),
    payments: z.array(z.object({ id: z.string(), amount: readMoney, method: z.string(), status: z.string(), processedAt: readDate.nullable(), createdAt: readDate })),
  })),
  facilities: z.array(z.object({ id: z.string(), name: z.string(), units: z.array(readUnit.extend({ id: z.string(), monthlyRate: readMoney })) })),
});
type Dialog = "payment" | "transfer" | "moveOut" | null;

const money = (value: string | number) =>
  `R ${Number(value).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const customerName = (account: Account) =>
  account.customer.companyName ||
  [account.customer.firstName, account.customer.lastName]
    .filter(Boolean)
    .join(" ") ||
  "Unnamed customer";
const occupancyLabel = (status?: string) => {
  if (status === "PENDING") return "Pending lease signature";
  if (status === "NOTICE_GIVEN") return "Notice given";
  if (status === "ACTIVE") return "Active occupancy";
  return "Access closed";
};

function generateReference(accountNumber: string) {
  const stamp = southAfricaDateKey(new Date()).replaceAll("-", "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${accountNumber}-${stamp}-${suffix}`;
}

export function AccountsWorkspace({
  initialAccountId,
  initialDocumentId,
}: {
  initialAccountId?: string;
  initialDocumentId?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detailOpen, setDetailOpen] = useState(Boolean(initialAccountId || initialDocumentId));
  const detailRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentRequestId, setPaymentRequestId] = useState("");
  const [moveOutIdempotencyKey, setMoveOutIdempotencyKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [readBusy, setReadBusy] = useState(true);
  const [readError, setReadError] = useState("");
  const [readAccess, setReadAccess] = useState<"signed-out" | "denied" | null>(null);
  const readRequest = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    readRequest.current?.abort();
    const controller = new AbortController(); readRequest.current = controller;
    setReadBusy(true); setReadError(""); setReadAccess(null); setData(null); setDialog(null);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/v1/accounts", { cache: "no-store", signal: controller.signal });
      if (readRequest.current !== controller) return false;
      if (response.status === 401 || response.status === 403) {
        setReadAccess(response.status === 401 ? "signed-out" : "denied");
        setReadError(response.status === 401 ? "Your session has ended. Sign in again to view accounts." : "Account access is unavailable. Please contact your administrator if you require access.");
        return false;
      }
      if (!response.ok) throw new Error("ACCOUNTS_READ_FAILED");
      const payload = await response.json();
      if (!accountsReadSchema.safeParse(payload.data).success) throw new Error("INVALID_ACCOUNTS_RESPONSE");
      if (controller.signal.aborted || readRequest.current !== controller) return false;
      const next = payload.data as Data;
      setData(next);
      if (!next.accounts.length) setDetailOpen(false);
      setSelectedId(current => {
        if (next.accounts.some(account => account.id === current)) return current;
        const linked = initialAccountId ? next.accounts.find(account => account.id === initialAccountId) : initialDocumentId ? next.accounts.find(account => account.tenancy?.documents.some(document => document.id === initialDocumentId)) : undefined;
        return linked?.id || next.accounts[0]?.id || "";
      });
      return true;
    } catch {
      if (readRequest.current === controller) setReadError("Accounts could not be loaded. Reload accounts to try again. No account action will be repeated.");
      return false;
    } finally {
      clearTimeout(timeout);
      if (readRequest.current === controller) { readRequest.current = null; setReadBusy(false); }
    }
  }, [initialAccountId, initialDocumentId]);
  useEffect(() => {
    const start = setTimeout(() => void load(), 0);
    return () => { clearTimeout(start); readRequest.current?.abort(); readRequest.current = null; };
  }, [load]);
  const selected =
    data?.accounts.find((account) => account.id === selectedId) ?? null;
  const visible = useMemo(
    () =>
      data?.accounts.filter((account) =>
        `${account.accountNumber} ${customerName(account)} ${account.tenancy?.occupancies[0]?.unit.number ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) ?? [],
    [data, search],
  );
  const active =
    data?.accounts.filter((account) =>
      ["ACTIVE", "NOTICE_GIVEN"].includes(account.tenancy?.status ?? ""),
    ).length ?? 0;
  const outstanding =
    data?.accounts.reduce(
      (sum, account) => sum + Math.max(0, Number(account.balance)),
      0,
    ) ?? 0;
  const paidToday =
    data?.accounts
      .flatMap((account) => account.payments)
      .filter(
        (payment) =>
          payment.status === "SUCCEEDED" &&
          new Date(payment.processedAt ?? payment.createdAt).toDateString() ===
            new Date().toDateString(),
      )
      .reduce((sum, payment) => sum + Number(payment.amount), 0) ?? 0;

  async function submitPayment(formData: FormData) {
    await submit(
      "/api/v1/accounts",
      {
        accountId: selectedId,
        requestId: paymentRequestId,
        amount: Number(formData.get("amount")),
        method: formData.get("method"),
        reference: formData.get("reference") || undefined,
        receivedAt: new Date(String(formData.get("receivedAt"))).toISOString(),
      },
      "Payment posted.",
    );
  }
  async function submitTransfer(formData: FormData) {
    await submit(
      "/api/v1/leasing/workflows/transfer",
      {
        tenancyId: selected?.tenancy?.id,
        toUnitId: formData.get("toUnitId"),
        effectiveAt: new Date(
          String(formData.get("effectiveAt")),
        ).toISOString(),
        monthlyRate: formData.get("monthlyRate")
          ? Number(formData.get("monthlyRate"))
          : undefined,
      },
      "Transfer completed.",
    );
  }
  async function submitMoveOut(formData: FormData) {
    await submit(
      "/api/v1/leasing/workflows/move-out",
      {
        tenancyId: selected?.tenancy?.id,
        movedOutAt: new Date(String(formData.get("movedOutAt"))).toISOString(),
        finalCharge: Number(formData.get("finalCharge") || 0),
        depositAction: formData.get("depositAction"),
        depositAmount: Number(formData.get("depositAmount") || 0),
        idempotencyKey: moveOutIdempotencyKey,
        notes: formData.get("notes") || undefined,
      },
      "Move-out completed.",
    );
  }
  async function submit(
    url: string,
    body: Record<string, unknown>,
    message: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          payload.error?.message ?? "The account action could not be completed.",
        );
        return;
      }
      setDialog(null);
      setNotice(payload.data?.notificationReviewRequired ? "Payment recorded. Its notification needs review in Communications." : message);
      try { await load(); }
      catch { setError("The action was recorded, but the account could not refresh. Reload before starting another action."); }
    } catch {
      setError(url === "/api/v1/accounts" ? "The response could not be confirmed. Retry this same form to check the result before starting another payment." : "The response could not be confirmed. Reload and check the account before starting another action.");
    } finally {
      setBusy(false);
    }
  }
  const facility = data?.facilities.find(
    (item) => item.id === selected?.tenancy?.facilityId,
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operations centre"
        title="Accounts"
        description="Manage tenant balances, payments, transfers and move-outs against live store records."
        action={
          <Link href="/operations/move-in" className="button button-primary">
            <Plus size={16} />
            Move in
          </Link>
        }
      />
      <section className="panel panel-spacious">
        {readError ? <p role="alert">{readError}</p> : null}
        {readAccess === "signed-out" ? <Link className="button button-primary" href="/login?next=%2Faccounts">Sign in again</Link> : <button className="button button-secondary" disabled={readBusy || busy || !!dialog} onClick={() => void load()}>{readBusy ? "Loading accounts…" : "Reload accounts"}</button>}
      </section>
      {error && !dialog ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}
      <section className="summary-strip">
        {[
          ["Active accounts", active],
          ["Outstanding", money(outstanding)],
          ["Collected today", money(paidToday)],
          ["Accounts", data?.accounts.length ?? 0],
        ].map(([label, value]) => (
          <div className="summary-cell" key={label}>
            <span>{label}</span>
            <strong>{data ? value : "—"}</strong>
          </div>
        ))}
      </section>
      <section className={`accounts-layout${detailOpen ? " account-open" : ""}`}>
        <aside className="panel accounts-list">
          <label className="toolbar-search">
            <Search size={16} />
            <input
              placeholder="Search account, tenant or unit"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {!data ? <p className="empty-cell" role="status">{readBusy ? "Loading accounts…" : "Account data is unavailable."}</p> : visible.length ? (
            visible.map((account) => (
              <button
                type="button"
                className={
                  selectedId === account.id
                    ? "account-list-row active"
                    : "account-list-row"
                }
                aria-label={`Open account ${account.accountNumber} for ${customerName(account)}`}
                aria-controls="selected-account-details"
                onClick={() => {
                  setSelectedId(account.id);
                  setDetailOpen(true);
                  requestAnimationFrame(() => {
                    detailRef.current?.focus({ preventScroll: true });
                    detailRef.current?.scrollIntoView({ block: "start" });
                  });
                }}
                key={account.id}
              >
                <span>
                  <strong>{customerName(account)}</strong>
                  <small>
                    {account.accountNumber} · Unit{" "}
                    {account.tenancy?.occupancies[0]?.unit.number ?? "—"}
                  </small>
                </span>
                <b className={Number(account.balance) > 0 ? "balance-due" : ""}>
                  {account.financialReviewRequired ? "Review test entries" : money(account.balance)}
                </b>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))
          ) : (
            <p className="empty-cell">No accounts found.</p>
          )}
        </aside>
        <article ref={detailRef} id="selected-account-details" tabIndex={-1} aria-label="Selected account details" className="panel panel-spacious account-detail">
          <button type="button" className="button button-secondary account-back" onClick={() => {
            setDetailOpen(false);
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".account-list-row.active")?.focus());
          }}><ArrowLeft size={16} /> Back to accounts</button>
          {selected ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{selected.accountNumber}</p>
                  <h2>{customerName(selected)}</h2>
                  <p className="panel-subtitle">
                    {selected.tenancy?.facility.name} · Unit{" "}
                    {selected.tenancy?.occupancies[0]?.unit.number ?? "—"} ·{" "}
                    {selected.customer.phone ||
                      selected.customer.email ||
                      "No contact details"}
                  </p>
                </div>
                <div className="account-balance">
                  <span>Balance</span>
                  <strong>{selected.financialReviewRequired ? "Reconciliation required" : money(selected.balance)}</strong>
                  <StatusPill
                    tone={Number(selected.balance) > 0 ? "warning" : "positive"}
                  >
                    {selected.financialReviewRequired ? "Historical test entries" : Number(selected.balance) > 0 ? "Amount due" : "No amount due"}
                  </StatusPill>
                </div>
              </div>
              <div className="account-actions">
                <button
                  className="button button-primary"
                  onClick={() => {
                    setError("");
                    setPaymentReference(
                      generateReference(selected.accountNumber),
                    );
                    setPaymentRequestId(crypto.randomUUID());
                    setDialog("payment");
                  }}
                >
                  <CreditCard size={16} />
                  Take payment
                </button>
                <button
                  className="button button-secondary"
                  disabled={selected.tenancy?.status !== "ACTIVE"}
                  onClick={() => {
                    setError("");
                    setDialog("transfer");
                  }}
                >
                  <ArrowRightLeft size={16} />
                  Transfer
                </button>
                <button
                  className="button button-secondary"
                  disabled={
                    !selected.tenancy ||
                    !["ACTIVE", "NOTICE_GIVEN"].includes(
                      selected.tenancy.status,
                    )
                  }
                  onClick={() => {
                    setError("");
                    setMoveOutIdempotencyKey(crypto.randomUUID());
                    setDialog("moveOut");
                  }}
                >
                  <DoorOpen size={16} />
                  Move out
                </button>
              </div>
              <div className="account-actions">
                <Link className="button button-secondary" href={`/operations/accounts/${selected.id}/statement`}><Download size={16} /> Account statement</Link>
              </div>
              <div className="account-info-grid">
                <div>
                  <span>Security status</span>
                  <strong>{occupancyLabel(selected.tenancy?.occupancies[0]?.status)}</strong>
                </div>
                <div>
                  <span>Monthly rent</span>
                  <strong>
                    {money(selected.tenancy?.occupancies[0]?.monthlyRate ?? 0)}
                  </strong>
                </div>
                <div>
                  <span>Unit type</span>
                  <strong>
                    {selected.tenancy?.occupancies[0]?.unit.unitType.name ??
                      "—"}
                  </strong>
                </div>
                <div>
                  <span>Tenancy status</span>
                  <strong>
                    {selected.tenancy?.status.replaceAll("_", " ") ?? "—"}
                  </strong>
                </div>
              </div>
              {selected.tenancy?.documents.some(
                (document) => document.status === "SIGNED",
              ) ? (
                <div className="account-actions">
                  {selected.tenancy.documents
                    .filter((document) => document.status === "SIGNED")
                    .slice(0, 1)
                    .map((document) => (
                      <span className="account-actions" key={document.id}>
                        <a
                          className="button button-secondary"
                          href={document.provider === "PUBLIC_RESERVATION" ? `/api/v1/public-leases/${document.externalId}/signed-pdf` : `/api/v1/documents/${document.id}/signed`}
                        >
                          <Download size={16} />
                          Completed lease
                        </a>
                        {document.provider !== "PUBLIC_RESERVATION" && <a
                          className="button button-secondary"
                          href={`/api/v1/documents/${document.id}/certificate`}
                        >
                          <FileCheck2 size={16} />
                          Completion certificate
                        </a>}
                      </span>
                    ))}
                </div>
              ) : null}
              {selected.financialReviewRequired && <p role="status">Historical sandbox entries appear in this ledger. They are not cleared rent. Finance must reconcile them before using the balance or issuing a statement; the original audit history is preserved.</p>}
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.ledgerEntries.length ? (
                      selected.ledgerEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            {formatSouthAfricaDate(entry.effectiveAt)}
                          </td>
                          <td>{entry.description}</td>
                          <td>{entry.type}</td>
                          <td
                            className={
                              ["PAYMENT", "CREDIT", "WRITE_OFF"].includes(entry.type) ? "credit-amount" : ""
                            }
                          >
                            {["PAYMENT", "CREDIT", "WRITE_OFF"].includes(entry.type) ? "− " : ""}
                            {money(entry.amount)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="empty-cell">
                          No account transactions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="empty-cell">Select an account.</p>
          )}
        </article>
      </section>
      {dialog && selected ? (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true">
            <button className="modal-close" disabled={busy} onClick={() => setDialog(null)}>
              <X size={18} />
            </button>
            <p className="eyebrow">{selected.accountNumber}</p>
            <h2>
              {dialog === "payment"
                ? "Take payment"
                : dialog === "transfer"
                  ? "Transfer unit"
                  : "Move out"}
            </h2>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {dialog === "payment" ? (
              <form onSubmit={event => { event.preventDefault(); void submitPayment(new FormData(event.currentTarget)); }} className="invite-form">
                <label>
                  Amount
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={Math.max(0, Number(selected.balance)) || ""}
                    required
                  />
                </label>
                <label>
                  Payment method
                  <select name="method" defaultValue="EFT">
                    <option value="EFT">EFT</option>
                    <option value="CARD">Card</option>
                    <option value="CASH">Cash</option>
                    <option value="BANK_DEBIT">Bank debit</option>
                  </select>
                </label>
                <label>
                  Reference
                  <input
                    name="reference"
                    maxLength={120}
                    value={paymentReference}
                    onChange={(event) =>
                      setPaymentReference(event.target.value)
                    }
                  />
                  <small>
                    Auto-generated — replace with the customer&apos;s bank/EFT
                    reference if you have one.
                  </small>
                </label>
                <label>
                  Date received
                  <input
                    name="receivedAt"
                    type="date"
                    defaultValue={southAfricaDateKey(new Date())}
                    required
                  />
                </label>
                <ActionButtons
                  busy={busy}
                  close={() => setDialog(null)}
                  label="Post payment"
                />
              </form>
            ) : null}
            {dialog === "transfer" ? (
              <form action={submitTransfer} className="invite-form">
                <label>
                  New unit
                  <select name="toUnitId" required>
                    <option value="">Select available unit</option>
                    {facility?.units.map((unit) => (
                      <option value={unit.id} key={unit.id}>
                        {unit.number} · {unit.unitType.name} ·{" "}
                        {money(unit.monthlyRate)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Effective date
                  <input
                    name="effectiveAt"
                    type="date"
                    defaultValue={southAfricaDateKey(new Date())}
                    required
                  />
                </label>
                <label>
                  Monthly rent override
                  <input name="monthlyRate" type="number" min="0" step="0.01" />
                </label>
                <ActionButtons
                  busy={busy}
                  close={() => setDialog(null)}
                  label="Complete transfer"
                />
              </form>
            ) : null}
            {dialog === "moveOut" ? (
              <form action={submitMoveOut} className="invite-form">
                <label>
                  Move-out date
                  <input
                    name="movedOutAt"
                    type="date"
                    defaultValue={southAfricaDateKey(new Date())}
                    required
                  />
                </label>
                <label>
                  Final charge
                  <input
                    name="finalCharge"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue="0"
                  />
                </label>
                <label>
                  Deposit treatment
                  <select name="depositAction" defaultValue="NONE" required>
                    <option value="NONE">No deposit action</option>
                    <option value="REFUND_DUE">Refund requires processing</option>
                    <option value="APPLY_TO_BALANCE">Apply deposit to balance</option>
                  </select>
                </label>
                <label>
                  Deposit amount
                  <input name="depositAmount" type="number" min="0" step="0.01" defaultValue="0" />
                </label>
                <label>
                  Move-out reason and condition notes
                  <textarea name="notes" rows={4} minLength={3} maxLength={2000} required />
                </label>
                <ActionButtons
                  busy={busy}
                  close={() => setDialog(null)}
                  label="Complete move-out"
                />
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionButtons({
  busy,
  close,
  label,
}: {
  busy: boolean;
  close: () => void;
  label: string;
}) {
  return (
    <div className="form-actions">
      <button type="button" className="button button-secondary" disabled={busy} onClick={close}>
        Cancel
      </button>
      <button className="button button-primary" disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}

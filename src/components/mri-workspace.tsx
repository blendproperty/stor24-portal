"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import type { mriConfiguration, mriSourceReview } from "@/lib/mri-service";

type Configuration = Awaited<ReturnType<typeof mriConfiguration>>;
type Review = Awaited<ReturnType<typeof mriSourceReview>>;
const endpoint = "/api/v1/billing/mri";
const monthNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).format(new Date());

export function MriWorkspace() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [month, setMonth] = useState(monthNow);
  const [review, setReview] = useState<Review | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: abort.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load MRI settings.");
      setConfig(body.configuration); setCanManage(body.canManage);
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load MRI settings."); });
    return () => abort.abort();
  }, []);

  async function save(data: FormData) {
    if (!config) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: config.revision, databaseLabel: data.get("databaseLabel"), environment: data.get("environment"), login: data.get("login"), password: data.get("password"), databaseIdentifier: data.get("databaseIdentifier") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save MRI settings.");
      setConfig(body.configuration);
      setNotice("Settings stored securely. MRI sign-in has not been tested. Journal posting remains disabled.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save. Reload to check the saved state."); }
    finally {
      // Credentials are write-only; never retain them in React state or local storage.
      for (const name of ["login", "password", "databaseIdentifier"]) {
        const input = form.current?.elements.namedItem(name);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      setBusy(false);
    }
  }

  async function loadReview() {
    setBusy(true); setError(""); setReview(null);
    try {
      const response = await fetch(`${endpoint}?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load the source review.");
      setReview(body);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load the source review."); }
    finally { setBusy(false); }
  }

  return <div className="page-stack mri-workspace">
    <PageHeader eyebrow="Finance connections" title="MRI accounting preparation" description="Prepare consolidated monthly journals for MRI Property Central. Tenant-level detail stays in STOR24." />
    <section className="panel">
      <h2>Posting is not yet available</h2>
      <p>API access has been provisioned. The API reference, database connection and accounting mappings still need verification before journals can be built and sent.</p>
      <ol>
        <li>Confirm the API authentication and journal instructions with MRI.</li>
        <li>Verify the database identifier and access to an authorised test database.</li>
        <li>Finance selects the dedicated property, entity, transaction codes, GL accounts and tax treatment.</li>
        <li>Build balanced journals, check duplicate handling, and reconcile a test batch in MRI before approving live use.</li>
      </ol>
    </section>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!config && !error && <p>Loading MRI settings…</p>}
    {config && <section className="panel">
      <h2>Connection details</h2>
      <p>Credentials: <strong>{config.credentialsStored ? "Stored; unverified" : "Not stored"}</strong>. Database identifier: <strong>{config.databaseIdentifierStored ? "Stored; unverified" : "Required from MRI"}</strong>.</p>
      {!config.encryptionReady && <p role="alert">Secure storage must be configured on the server before saving credentials.</p>}
      {canManage ? <form ref={form} action={save}>
        <fieldset disabled={busy || !config.encryptionReady}>
          <div className="mri-fields">
            <label>Database label<input name="databaseLabel" required maxLength={100} defaultValue={config.databaseLabel} placeholder="Name supplied by MRI" /></label>
            <label>Database environment<select name="environment" defaultValue={config.environment}><option value="unknown">Not confirmed</option><option value="test">Test</option><option value="live">Live</option></select></label>
            <label>API login<input name="login" autoComplete="off" maxLength={254} required={!config.credentialsStored} placeholder={config.credentialsStored ? "Leave blank to keep stored login" : "API login supplied by MRI"} /></label>
            <label>API password<input name="password" type="password" autoComplete="new-password" maxLength={1000} required={!config.credentialsStored} placeholder={config.credentialsStored ? "Leave blank to keep stored password" : "API password"} /></label>
            <label>Database identifier<input name="databaseIdentifier" type="password" autoComplete="off" maxLength={200} placeholder={config.databaseIdentifierStored ? "Leave blank to keep stored identifier" : "Optional until supplied by MRI"} /></label>
          </div>
          <p>Changing the database label or environment clears the stored identifier unless you enter it again. Replace the login and password together.</p>
          <button type="submit" className="button button-primary">{busy ? "Working…" : "Save encrypted settings"}</button>
        </fieldset>
      </form> : <p>You have read-only access to MRI preparation.</p>}
    </section>}
    {config && <section className="panel">
      <h2>Monthly source review</h2>
      <p>Review ledger movements by store and type before agreeing the accounting mappings. These totals are not balanced journals, approved revenue, a trial balance or an MRI import file.</p>
      <div className="mri-controls">
        <label>Month<input type="month" value={month} max={monthNow()} disabled={busy} onChange={e => { setMonth(e.target.value); setReview(null); }} /></label>
        <button className="button button-secondary" disabled={busy || !month} onClick={loadReview}>Review source movements</button>
      </div>
      {review && <div aria-live="polite">
        <p><strong>{review.month}{review.partial ? " — month still open" : ""}</strong> · {review.rowCount} ledger movements · {review.excluded} excluded · {review.unassigned} without a store</p>
        <p>Accounts with any test-payment history or a payment in another currency are excluded in full ({review.quarantinedAccounts} accounts). Remaining movements still need receipt, balance, mapping and finance checks. Bank fees, payouts, merchandise and other sources are not added by this ledger-only review.</p>
        <div className="mri-table"><table><thead><tr><th>Store</th><th>Movement</th><th>Count</th><th>Recorded amount (R)</th><th>Recorded tax (R)</th></tr></thead><tbody>
          {review.groups.map((g, i) => <tr key={i}><td>{g.facility}</td><td>{g.type.replaceAll("_", " ")}</td><td>{g.count}</td><td>{g.amount}</td><td>{g.tax}</td></tr>)}
          {!review.groups.length && <tr><td colSpan={5}>No included movements for this month.</td></tr>}
        </tbody></table></div>
        <p>Amounts and tax are shown separately as stored. No debit/credit or net/gross interpretation has been applied.</p>
        <p>{review.legacyQueue} historical payment queue records remain held. They are not journal batches and will not be sent automatically.</p>
        <details><summary>Review evidence</summary><p>Generated: {review.generatedAt}</p><p className="mri-fingerprint">Source fingerprint: {review.fingerprint}</p><p>This is a fresh read, not a saved or approved batch. New or corrected movements require a new review.</p></details>
      </div>}
    </section>}
    <style jsx>{`
      .mri-workspace { max-width: 1200px; }
      .panel { padding: 24px; }
      h2 { margin-bottom: 12px; }
      p, li { line-height: 1.6; }
      ol { padding-left: 24px; margin-top: 16px; }
      fieldset { border: 0; padding: 0; min-width: 0; }
      .mri-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
      label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; }
      input, select { width: 100%; min-width: 0; padding: 11px; border: 1px solid #d9dee5; border-radius: 8px; background: white; color: #182332; font: inherit; }
      .mri-controls { display: flex; align-items: end; flex-wrap: wrap; gap: 16px; margin: 20px 0; }
      .mri-table { overflow-x: auto; margin: 20px 0; }
      table { width: 100%; min-width: 660px; border-collapse: collapse; }
      th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e1e5eb; }
      .mri-fingerprint { overflow-wrap: anywhere; }
      @media (max-width: 600px) { .mri-fields { grid-template-columns: 1fr; } .panel { padding: 16px; } }
    `}</style>
  </div>;
}

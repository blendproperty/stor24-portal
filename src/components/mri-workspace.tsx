"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Database, FileText, LockKeyhole, RefreshCw, Settings2 } from "lucide-react";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setSettingsOpen(true);
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: config.revision, databaseLabel: data.get("databaseLabel"), environment: data.get("environment"), login: data.get("login"), password: data.get("password"), databaseIdentifier: data.get("databaseIdentifier"), databaseKey: String(data.get("databaseKey") ?? "") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save MRI settings.");
      setConfig(body.configuration);
      setNotice("Settings saved. Check the connection to verify your changes.");
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

  async function checkConnection() {
    if (!config?.revision) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "check", revision: config.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to check the connection.");
      setConfig(body.configuration);
      if (body.configuration.authenticated && !body.configuration.databaseIdentifierStored) setSettingsOpen(true);
      setNotice(body.configuration.databaseReadable ? "Connection verified. Sign-in and database read both succeeded." : body.configuration.authenticated ? "Sign-in verified. Select a database in Connection settings, save and check again." : "Connection could not be verified. Review the result below.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to check the connection."); }
    finally { setBusy(false); }
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

  const verified = Boolean(config?.authenticated && config?.databaseReadable);
  const showSettings = settingsOpen || Boolean(config && !config.credentialsStored);
  const checkedAt = config?.checkedAt ? new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(config.checkedAt)) : null;
  const connectionTitle = verified ? `Connected to ${config?.databaseLabel || "MRI"}` : config?.authenticated ? "Select your database" : config?.credentialsStored ? "Connection needs a check" : "Connect to MRI";
  const failure = config?.failureCode && ({
    MRI_AUTH_REJECTED: "MRI rejected the sign-in or database access. Check the login and account permissions in Connection settings.",
    MRI_NETWORK: "MRI could not be reached. Check again when the service is available.",
    MRI_RESPONSE_INVALID: "MRI returned an unexpected response. The connection has not been verified.",
    MRI_PROVIDER_UNAVAILABLE: "MRI could not complete the check. Please try again later.",
    MRI_CREDENTIALS_UNREADABLE: "Stored credentials could not be opened. Contact your system administrator.",
  } as Record<string, string>)[config.failureCode];
  const movementName = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, char => char.toUpperCase());

  return <div className="mri-workspace">
    <header className="mri-heading">
      <div><p className="mri-eyebrow">Finance / Integrations</p><h1>MRI accounting</h1><p className="mri-subtitle">Your accounting connection and monthly ledger review.</p></div>
      <span className="mri-mode"><LockKeyhole size={14} aria-hidden="true" /> Read-only workspace</span>
    </header>
    {error && <p role="alert" className="mri-message mri-message-error">{error}</p>}
    {notice && <p role="status" className="mri-message">{notice}</p>}
    {!config && !error && <div className="mri-loading" role="status">Loading your MRI connection…</div>}
    {config && <>
      <section className="mri-connection" aria-labelledby="mri-connection-title">
        <div className="mri-connection-overview">
          <span className={`mri-connection-icon ${verified ? "is-verified" : ""}`}><Database size={24} strokeWidth={1.6} aria-hidden="true" /></span>
          <div className="mri-connection-copy">
            <div className="mri-title-line"><h2 id="mri-connection-title">{connectionTitle}</h2><span className={`mri-badge ${verified ? "mri-badge-green" : "mri-badge-neutral"}`}>{verified ? <><Check size={13} aria-hidden="true" /> Read access verified</> : "Setup in progress"}</span></div>
            <p>{checkedAt ? `Last checked ${checkedAt} SAST` : "Save your MRI details, then run a connection check."}</p>
          </div>
          {canManage && <button type="button" className="mri-button mri-button-secondary" disabled={busy || !config.credentialsStored || !config.encryptionReady} onClick={checkConnection}><RefreshCw size={15} aria-hidden="true" /> Check connection</button>}
        </div>
        <dl className="mri-connection-facts">
          <div><dt>Database</dt><dd>{config.databaseLabel || "Not selected"}</dd></div>
          <div><dt>Environment</dt><dd>{config.environment === "live" ? "Live" : config.environment === "test" ? "Test" : "Awaiting confirmation"}</dd></div>
          <div><dt>MRI sign-in</dt><dd>{config.authenticated ? "Verified" : config.credentialsStored ? "Ready to check" : "Not configured"}</dd></div>
          <div><dt>Database read</dt><dd>{config.databaseReadable ? "Verified" : config.databaseIdentifierStored ? "Ready to check" : "Database required"}</dd></div>
        </dl>
        {failure && <p role="alert" className="mri-message mri-message-error">{failure}</p>}
        {!config.encryptionReady && <p role="alert" className="mri-message mri-message-error">Secure storage must be configured before credentials can be saved.</p>}
        {config.databaseReadable && config.propertyCount === 0 && <p className="mri-property-note"><span className="mri-note-dot" />No properties returned by MRI. Confirm that the STOR24 finance property is assigned to this account.</p>}
        <div className="mri-settings-bar"><p><LockKeyhole size={14} aria-hidden="true" /> Checks use saved settings and do not change MRI records.</p>{canManage ? <button className="mri-settings-toggle" type="button" aria-expanded={showSettings} aria-controls="mri-connection-settings" onClick={() => setSettingsOpen(!settingsOpen)} disabled={busy || !config.credentialsStored}><Settings2 size={15} aria-hidden="true" />Connection settings<ChevronDown size={14} className={showSettings ? "mri-rotate" : ""} aria-hidden="true" /></button> : <span className="mri-readonly">Read-only access</span>}</div>
        {canManage && showSettings && <div id="mri-connection-settings" className="mri-settings">
          <div className="mri-section-heading"><div><h3>Connection settings</h3><p>Stored credentials stay private. Leave a field blank to keep its saved value.</p></div><span className="mri-badge mri-badge-neutral">Encrypted storage</span></div>
          <form ref={form} action={save}>
            <fieldset disabled={busy || !config.encryptionReady}>
              <div className="mri-fields">
                <label>Database label<input key={config.databaseLabel} name="databaseLabel" required maxLength={100} defaultValue={config.databaseLabel} placeholder="Name supplied by MRI" /></label>
                <label>Database environment<select name="environment" defaultValue={config.environment}><option value="unknown">Not confirmed</option><option value="test">Test</option><option value="live">Live</option></select></label>
                {config.databases?.length > 0 && <label className="mri-field-wide">Databases returned by MRI<select name="databaseKey" defaultValue=""><option value="">Keep saved database</option>{config.databases.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select><small>Selecting a database also saves its identifier.</small></label>}
                <label>API login<input name="login" autoComplete="off" maxLength={254} required={!config.credentialsStored} placeholder={config.credentialsStored ? "Saved login · leave blank to keep" : "API activation email"} /></label>
                <label>API password<input name="password" type="password" autoComplete="new-password" maxLength={1000} required={!config.credentialsStored} placeholder={config.credentialsStored ? "Saved password · leave blank to keep" : "API password"} /></label>
              </div>
              <details className="mri-manual"><summary>Enter a database identifier manually<ChevronDown size={14} aria-hidden="true" /></summary><label>Database identifier<input name="databaseIdentifier" type="password" autoComplete="off" maxLength={200} placeholder={config.databaseIdentifierStored ? "Saved identifier · leave blank to keep" : "Identifier supplied by MRI"} /></label></details>
              <p className="mri-field-help">Replace login and password together. Changing the database label or environment clears its saved identifier unless you select or enter one again.</p>
              <div className="mri-save-row"><button type="submit" className="mri-button mri-button-primary" disabled={busy}>{busy ? "Please wait…" : "Save settings"}</button><span>Check the connection again after saving.</span></div>
            </fieldset>
          </form>
          {config.authenticated && !config.discoveryAvailable && <p className="mri-field-help">MRI did not return a database list. Use the identifier supplied by MRI.</p>}
        </div>}
      </section>
      <div className="mri-main-grid">
        <section className="mri-review" aria-labelledby="mri-review-title">
          <div className="mri-section-heading"><div><p className="mri-kicker">Ledger review</p><h2 id="mri-review-title">Monthly movements</h2><p>Review source entries by store before preparing journals.</p></div><FileText size={21} strokeWidth={1.5} aria-hidden="true" /></div>
          <div className="mri-controls"><label>Month<input type="month" value={month} max={monthNow()} disabled={busy} onChange={e => { setMonth(e.target.value); setReview(null); }} /></label><button type="button" className="mri-button mri-button-primary" disabled={busy || !month} onClick={loadReview}>Review movements</button></div>
          {!review && <div className="mri-empty"><span><FileText size={26} strokeWidth={1.3} aria-hidden="true" /></span><h3>Choose a month to review</h3><p>See ledger movements, exclusions and recorded amounts. Nothing is sent to MRI.</p></div>}
          {review && <div aria-live="polite">
            <div className="mri-review-label"><h3>{new Intl.DateTimeFormat("en-ZA", {month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${review.month}-01T12:00:00Z`))}</h3>{review.partial && <span className="mri-badge mri-badge-amber">Month still open</span>}</div>
            <dl className="mri-metrics"><div><dt>Ledger movements</dt><dd>{review.rowCount}</dd></div><div><dt>Excluded</dt><dd>{review.excluded}</dd></div><div><dt>Without a store</dt><dd>{review.unassigned}</dd></div></dl>
            <div className="mri-table" role="region" aria-label="Monthly ledger movements" tabIndex={0}><table><thead><tr><th scope="col">Store</th><th scope="col">Movement</th><th scope="col" className="mri-number">Entries</th><th scope="col" className="mri-number">Amount (R)</th><th scope="col" className="mri-number">Tax (R)</th></tr></thead><tbody>{review.groups.map((g, i) => <tr key={i}><th scope="row">{g.facility}</th><td><span className="mri-movement-type">{movementName(g.type)}</span></td><td className="mri-number" data-label="Entries">{g.count}</td><td className="mri-number" data-label="Amount (R)">{g.amount}</td><td className="mri-number" data-label="Tax (R)">{g.tax}</td></tr>)}{!review.groups.length && <tr><td colSpan={5} className="mri-no-rows">No included movements for this month.</td></tr>}</tbody></table></div>
            <p className="mri-review-caption">Recorded ledger amounts only. This is not an approved journal or revenue total.</p>
            <details className="mri-details"><summary>Exclusions & review notes<ChevronDown size={15} aria-hidden="true" /></summary><div><p>{review.quarantinedAccounts} accounts are excluded in full because they contain test-payment history or payments in another currency. Included movements still require finance checks.</p><p>This review excludes bank fees, payouts, merchandise and other non-ledger sources. Amount and tax are shown separately as stored; no debit/credit or net/gross treatment has been applied.</p><p>{review.legacyQueue} historical payment queue records remain held. They are not journal batches and will not be sent automatically.</p></div></details>
            <details className="mri-details"><summary>Review evidence<ChevronDown size={15} aria-hidden="true" /></summary><div><p>Generated: {review.generatedAt}</p><p className="mri-fingerprint">Source fingerprint: {review.fingerprint}</p><p>This is a fresh read, not a saved or approved batch. New or corrected movements require a new review.</p></div></details>
          </div>}
        </section>
        <aside className="mri-readiness" aria-labelledby="mri-readiness-title">
          <div className="mri-readiness-heading"><span className="mri-kicker">Journal readiness</span><span className="mri-badge mri-badge-amber">Posting off</span></div>
          <h2 id="mri-readiness-title">Before journals can be sent</h2><p>The connection is the first step. These requirements are still open.</p>
          <ol className="mri-checklist"><li><span>01</span><div><h3>Finance property</h3><p>Confirm the dedicated STOR24 property and entity in MRI.</p></div></li><li><span>02</span><div><h3>Journal method & mappings</h3><p>Agree the supported import method, accounts, transaction codes and tax treatment.</p></div></li><li><span>03</span><div><h3>Test & reconcile</h3><p>Build balanced journals, prove duplicate handling and reconcile an authorised test batch before live approval.</p></div></li></ol>
          <div className="mri-readiness-footer"><LockKeyhole size={16} aria-hidden="true" /><p>Journal posting is not yet available. No financial entries are sent from this screen.</p></div>
        </aside>
      </div>
    </>}
  </div>;
}

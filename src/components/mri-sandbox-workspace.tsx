"use client";
import { useEffect, useState } from "react";
import type { mriSandboxWorkspace } from "@/lib/mri-service";
type Workspace = Awaited<ReturnType<typeof mriSandboxWorkspace>>;
const endpoint = "/api/v1/billing/mri/sandbox";
const failures: Record<string, string> = {
  MRI_SANDBOX_SHARED_TARGET: "The primary accounting connection now points to this same test target. Separate the targets before continuing.",
  MRI_SANDBOX_TARGET: "Current MRI discovery did not verify the exact BlendTest target. Access remains unverified.",
  MRI_AUTH_REJECTED: "MRI rejected sign-in or test-database access. Review the stored account's permissions.",
  MRI_NETWORK: "MRI could not be reached. A fresh successful check is required.",
  MRI_RESPONSE_INVALID: "MRI returned an unexpected response. Access remains unverified.",
  MRI_PROVIDER_UNAVAILABLE: "MRI could not complete this check. Try again when the service is available.",
  MRI_CREDENTIALS_UNREADABLE: "The stored credentials need administrator review.",
};
export function MriSandboxWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: abort.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setWorkspace(data); setCanManage(data.canManage); }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load sandbox."); });
    return () => abort.abort();
  }, []);
  async function act(action: "prepare" | "check") {
    if (!workspace) return; setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, revision: workspace.configuration.revision, ...(action === "prepare" ? { sourceRevision: workspace.sourceRevision } : {}) }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error); setWorkspace(data);
      setNotice(action === "prepare" ? "Separate sandbox settings saved. Run the sandbox check next." : data.configuration.databaseReadable ? "BlendTest sign-in, exact target discovery and property read succeeded." : "Sandbox access was not verified. Review the result below.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete sandbox action."); } finally { setBusy(false); }
  }
  const config = workspace?.configuration;
  const verified = config?.authenticated && config.databaseReadable;
  return <div className="mri-mapping mri-sandbox">
    <a href="/billing/mri">← MRI accounting</a><header><p className="mapping-kicker">MRI integration · Test environment</p><h1>MRI sandbox testing</h1><p>Test the real MRI API against BlendTest using the stored account. Sandbox settings and check results are separate from the primary accounting connection.</p></header>
    {error && <p role="alert" className="mapping-error">{error}</p>}{notice && <p role="status" className="mapping-notice">{notice}</p>}
    {!workspace && !error && <p role="status">Loading sandbox settings…</p>}
    {workspace && config && <>
      <section className="mapping-panel"><h2>BlendTest connection</h2><p><strong>{verified ? "Sandbox read access verified" : config.credentialsStored ? "Sandbox check required" : "Sandbox not prepared"}</strong></p>
        <dl><dt>Environment</dt><dd>Test only</dd><dt>Target</dt><dd>{workspace.target}</dd><dt>Last check</dt><dd>{config.checkedAt ? new Date(config.checkedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) + " SAST" : "No check recorded"}</dd><dt>Accessible properties</dt><dd>{config.propertyCount ?? "Not checked"}</dd></dl>
        {config.failureCode && failures[config.failureCode] && <p className="mapping-error">{failures[config.failureCode]}</p>}
        {canManage ? <div className="mapping-actions"><button disabled={busy || !workspace.storedTestAvailable || !workspace.sourceRevision} onClick={() => act("prepare")}>{config.credentialsStored ? "Refresh from stored test connection" : "Use stored test connection"}</button><button disabled={busy || !config.credentialsStored || !config.revision} onClick={() => act("check")}>Run sandbox check</button></div> : <p>You have read-only access. An organisation-wide MRI manager can prepare and check this connection.</p>}
        {!workspace.storedTestAvailable && <p>The stored MRI account must discover BlendTest. Run a connection check in MRI accounting to refresh the database list.</p>}
        <p>The check authenticates, verifies the exact test database against current MRI discovery and reads one page of property metadata. Tokens and database identifiers stay private.</p>
      </section>
      <section className="mapping-panel"><h2>Journal testing readiness</h2>
        {verified && config.propertyCount === 0 && <p className="mapping-error">MRI returned no accessible properties in BlendTest. Create or assign the dedicated test property and entity before testing journals.</p>}
        <ol><li>Verify sandbox access and the dedicated test property/entity.</li><li>Agree test GL accounts, tax codes, source classification and the accounting basis with finance.</li><li>Confirm the MRI journal import and lookup contract, then implement balanced batches, duplicate controls and reconciliation.</li></ol>
        <p><a href="/billing/mri/sandbox/mapping">Prepare sandbox-only finance mappings</a> and <a href="/billing/mri/sandbox/batches">prepare sandbox journal batches</a>. These internal controls do not submit financial entries.</p>
        <p><strong>Journal submission is not available yet.</strong> This screen performs real API authentication and reads only. No tenant ledger, payment, outbox or MRI financial entries are changed.</p>
      </section>
    </>}
  </div>;
}

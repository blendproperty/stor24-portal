"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type Configuration = {
  encryptionReady: boolean;
  environment: "test";
  merchantAccountConfigured: boolean;
  accountServiceKeyConfigured: boolean;
  debitOrderServiceKeyConfigured: boolean;
  payNowServiceKeyConfigured: boolean;
  transactionProcessingEnabled: boolean;
  status: string;
  lastSuccessAt: string | null;
  failureMessage: string | null;
};

function statusTone(status: string) { return status === "CONNECTED" ? "positive" : status === "DEGRADED" ? "warning" : "neutral"; }
function statusLabel(status: string) { return status === "CONNECTED" ? "Test keys validated" : status === "DEGRADED" ? "Validation failed" : "Configuration required"; }

export function NetcashIntegrationWorkspace() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/integrations/netcash", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) { setError(payload.error?.message ?? "Netcash configuration could not be loaded."); return; }
        setConfiguration(payload.data); setCanManage(payload.meta.canManage); setError("");
      });
    return () => { cancelled = true; };
  }, []);

  async function validateAndSave(formData: FormData) {
    setBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/v1/integrations/netcash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "validate-and-save",
        payload: {
          merchantAccount: String(formData.get("merchantAccount") ?? ""),
          accountServiceKey: String(formData.get("accountServiceKey") ?? ""),
          debitOrderServiceKey: String(formData.get("debitOrderServiceKey") ?? ""),
          payNowServiceKey: String(formData.get("payNowServiceKey") ?? ""),
        },
      }),
    });
    const payload = await response.json(); setBusy(false);
    if (!response.ok) { setError(payload.error?.message ?? "Netcash validation failed. No credentials were saved."); return; }
    setConfiguration(payload.data);
    setNotice("All three Netcash test service keys validated and were stored securely. Transaction processing remains disabled.");
  }

  const configuredCount = configuration ? [configuration.accountServiceKeyConfigured, configuration.debitOrderServiceKeyConfigured, configuration.payNowServiceKeyConfigured].filter(Boolean).length : 0;
  return <div className="page-stack">
    <PageHeader eyebrow="Company setup · Integrations" title="Netcash test connection" description="Validate the dedicated Netcash test account and store its service keys securely. This screen cannot submit payments or debit orders." />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="form-success"><CheckCircle2 size={16}/>{notice}</p> : null}
    {!configuration?.encryptionReady ? <p className="safe-config-note"><LockKeyhole size={17}/>Secure credential storage is not enabled on the server. Enable it before entering any Netcash service key.</p> : null}
    <section className="summary-strip">
      <div className="summary-cell"><span>Environment</span><strong>Dedicated test account</strong></div>
      <div className="summary-cell"><span>Service keys</span><strong>{configuredCount}/3 validated</strong></div>
      <div className="summary-cell"><span>Connection</span><strong>{statusLabel(configuration?.status ?? "DISCONNECTED")}</strong></div>
      <div className="summary-cell"><span>Transactions</span><strong>{configuration?.transactionProcessingEnabled ? "Enabled" : "Disabled"}</strong></div>
    </section>
    <form action={validateAndSave} className="panel panel-spacious company-form">
      <div className="panel-heading"><div><p className="eyebrow">Credential validation only</p><h2>Netcash test account</h2><p className="panel-subtitle">Netcash validates the account/key pairing before Stor24 stores anything. Keys are encrypted and never returned to this page.</p></div><KeyRound className="positive-icon"/></div>
      <div className="field-grid two-column">
        <label>Netcash test account number<input name="merchantAccount" inputMode="numeric" pattern="[0-9]{12}" maxLength={12} required placeholder={configuration?.merchantAccountConfigured ? "Saved — enter to revalidate" : "12-digit test account number"} disabled={!canManage}/></label>
        <label>Account Services key<input name="accountServiceKey" type="password" autoComplete="new-password" required placeholder={configuration?.accountServiceKeyConfigured ? "Saved — enter to revalidate" : "Service key from Netcash email"} disabled={!canManage}/></label>
        <label>Debit Orders key<input name="debitOrderServiceKey" type="password" autoComplete="new-password" required placeholder={configuration?.debitOrderServiceKeyConfigured ? "Saved — enter to revalidate" : "Service key from Netcash email"} disabled={!canManage}/></label>
        <label>Pay Now key<input name="payNowServiceKey" type="password" autoComplete="new-password" required placeholder={configuration?.payNowServiceKeyConfigured ? "Saved — enter to revalidate" : "Service key from Netcash email"} disabled={!canManage}/></label>
      </div>
      <p className="safe-config-note"><ShieldCheck size={17}/>This check calls Netcash ValidateServiceKey only. It creates no customer, mandate, debit-order batch, payment, ledger entry or settlement. Three invalid attempts can temporarily lock the Netcash account, so values are validated as a single request.</p>
      <div className="hikvision-health"><StatusPill tone={statusTone(configuration?.status ?? "DISCONNECTED")}>{statusLabel(configuration?.status ?? "DISCONNECTED")}</StatusPill><span>{configuration?.lastSuccessAt ? `Last successful validation ${new Date(configuration.lastSuccessAt).toLocaleString("en-ZA")}` : configuration?.failureMessage ?? "No successful provider validation yet."}</span></div>
      <div className="form-footer"><button className="button button-primary" disabled={!canManage || !configuration?.encryptionReady || busy}><RefreshCw size={15}/>{busy ? "Validating…" : "Validate and save test keys"}</button></div>
    </form>
  </div>;
}

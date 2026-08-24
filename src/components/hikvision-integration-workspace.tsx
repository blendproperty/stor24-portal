"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Link2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type CompanyConfiguration = { endpoint: string; appKeyConfigured: boolean; appSecretConfigured: boolean; status: string; lastHealthAt: string | null; lastSuccessAt: string | null; failureMessage: string | null };
type FacilityConfiguration = { id: string; name: string; code: string; organisationIndexCode: string; doorIndexCodes: string[]; status: string; lastHealthAt: string | null; lastSuccessAt: string | null; failureMessage: string | null };
type Configuration = { encryptionReady: boolean; company: CompanyConfiguration; facilities: FacilityConfiguration[] };

function statusTone(status: string) { return status === "CONNECTED" ? "positive" : status === "DEGRADED" ? "warning" : "neutral"; }
function statusLabel(status: string) { return status === "CONNECTED" ? "Connected" : status === "DEGRADED" ? "Connection failed" : status === "CONFIGURED" ? "Ready to test" : "Configuration required"; }

export function HikvisionIntegrationWorkspace() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/integrations/hikvision", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) { setError(payload.error?.message ?? "Hikvision configuration could not be loaded."); return; }
        setConfiguration(payload.data); setCanManage(payload.meta.canManage); setFacilityId(payload.data.facilities[0]?.id || ""); setError("");
      });
    return () => { cancelled = true; };
  }, []);
  const facility = useMemo(() => configuration?.facilities.find((item) => item.id === facilityId), [configuration, facilityId]);

  async function call(method: "PUT" | "POST", body: Record<string, unknown>, success: string) {
    setBusy(String(body.action)); setError(""); setNotice("");
    const response = await fetch("/api/v1/integrations/hikvision", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json(); setBusy("");
    if (!response.ok) { setError(payload.error?.message ?? payload.data?.message ?? "The Hikvision action failed."); if (payload.configuration) setConfiguration(payload.configuration); return; }
    if (payload.data?.facilities) setConfiguration(payload.data); else if (payload.configuration) setConfiguration(payload.configuration);
    setNotice(success);
  }

  function saveCredentials(formData: FormData) {
    void call("PUT", { action: "save-credentials", payload: { endpoint: String(formData.get("endpoint") ?? ""), appKey: String(formData.get("appKey") ?? "") || undefined, appSecret: String(formData.get("appSecret") ?? "") || undefined } }, "HikCentral credentials saved securely. Test a facility connection next.");
  }

  function saveMapping(formData: FormData) {
    const doorIndexCodes = String(formData.get("doorIndexCodes") ?? "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    void call("PUT", { action: "save-mapping", payload: { facilityId, organisationIndexCode: String(formData.get("organisationIndexCode") ?? ""), doorIndexCodes } }, "Facility and door mapping saved. Test the connection before using facial access.");
  }

  return <div className="page-stack">
    <PageHeader eyebrow="Company setup · Integrations" title="Hikvision access control" description="Connect Stor24 directly to HikCentral for consent-led facial enrolment, facility permissions and immediate revocation." />
    {error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p className="form-success"><CheckCircle2 size={16}/>{notice}</p> : null}
    {!configuration?.encryptionReady ? <p className="safe-config-note"><LockKeyhole size={17}/>Secure credential storage is not enabled on the server yet. Add the encryption key before entering the HikCentral App Key or App Secret.</p> : null}
    <section className="summary-strip">
      <div className="summary-cell"><span>Provider</span><strong>Hikvision</strong></div>
      <div className="summary-cell"><span>Company credentials</span><strong>{configuration?.company.appSecretConfigured ? "Saved" : "Required"}</strong></div>
      <div className="summary-cell"><span>Mapped facilities</span><strong>{configuration?.facilities.filter((item) => item.organisationIndexCode && item.doorIndexCodes.length).length ?? 0}/{configuration?.facilities.length ?? 0}</strong></div>
      <div className="summary-cell"><span>Connection state</span><strong>{statusLabel(facility?.status ?? configuration?.company.status ?? "DISCONNECTED")}</strong></div>
    </section>
    <section className="hikvision-layout">
      <form action={saveCredentials} className="panel panel-spacious company-form">
        <div className="panel-heading"><div><p className="eyebrow">Company connection</p><h2>HikCentral OpenAPI credentials</h2><p className="panel-subtitle">Secrets are encrypted before storage and are never returned to this page.</p></div><KeyRound className="positive-icon"/></div>
        <div className="field-grid">
          <label>HikCentral server address<input name="endpoint" type="url" required placeholder="https://hikcentral.example.co.za" defaultValue={configuration?.company.endpoint ?? ""} disabled={!canManage}/></label>
          <label>App Key<input name="appKey" type="password" autoComplete="new-password" placeholder={configuration?.company.appKeyConfigured ? "Saved — leave blank to keep" : "Enter App Key"} disabled={!canManage}/></label>
          <label>App Secret<input name="appSecret" type="password" autoComplete="new-password" placeholder={configuration?.company.appSecretConfigured ? "Saved — leave blank to keep" : "Enter App Secret"} disabled={!canManage}/></label>
        </div>
        <p className="safe-config-note"><ShieldCheck size={17}/>Saving replacement credentials automatically removes the previous usable values. Audit records contain only the endpoint and whether credentials are configured.</p>
        <div className="form-footer"><button className="button button-primary" disabled={!canManage || !configuration?.encryptionReady || busy === "save-credentials"}>{busy === "save-credentials" ? "Saving…" : "Save credentials"}</button></div>
      </form>
      <form action={saveMapping} className="panel panel-spacious company-form" key={facility?.id ?? "none"}>
        <div className="panel-heading"><div><p className="eyebrow">Facility mapping</p><h2>Organisation and doors</h2><p className="panel-subtitle">Only the doors listed here will be granted to customers at the selected facility.</p></div><Link2 className="positive-icon"/></div>
        <label className="facility-picker hikvision-facility-picker"><span>Facility</span><select value={facilityId} onChange={(event) => { setFacilityId(event.target.value); setNotice(""); setError(""); }}>{configuration?.facilities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="field-grid">
          <label>HikCentral organisation index code<input name="organisationIndexCode" required defaultValue={facility?.organisationIndexCode ?? ""} disabled={!canManage}/></label>
          <label>Door index codes<textarea name="doorIndexCodes" required rows={6} defaultValue={facility?.doorIndexCodes.join("\n") ?? ""} placeholder={'One door code per line\ne.g. midpoint-main-entry'} disabled={!canManage}/></label>
        </div>
        <p className="field-help">Use HikCentral index codes, not the visible door names. Duplicate codes are removed automatically.</p>
        <div className="hikvision-actions"><button className="button button-secondary" disabled={!canManage || !facilityId || busy === "save-mapping"}>{busy === "save-mapping" ? "Saving…" : "Save mapping"}</button><button type="button" className="button button-primary" disabled={!canManage || !facilityId || busy === "test-connection"} onClick={() => void call("POST", { action: "test-connection", facilityId }, "HikCentral connection verified for this facility.")}><RefreshCw size={15}/>{busy === "test-connection" ? "Testing…" : "Test connection"}</button></div>
        <div className="hikvision-health"><StatusPill tone={statusTone(facility?.status ?? "DISCONNECTED")}>{statusLabel(facility?.status ?? "DISCONNECTED")}</StatusPill><span>{facility?.lastSuccessAt ? `Last successful check ${new Date(facility.lastSuccessAt).toLocaleString("en-ZA")}` : facility?.failureMessage ?? "No successful live check yet."}</span></div>
      </form>
    </section>
  </div>;
}

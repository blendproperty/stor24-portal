"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Link2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";

type CompanyConfiguration = { endpoint: string; userId: string; appKeyConfigured: boolean; appSecretConfigured: boolean; pinnedCertSha256Fingerprint: string; regionIndexCode: string; status: string; lastHealthAt: string | null; lastSuccessAt: string | null; failureMessage: string | null };
type FacilityConfiguration = { id: string; name: string; code: string; organisationIndexCode: string; doorIndexCodes: string[]; status: string; lastHealthAt: string | null; lastSuccessAt: string | null; failureMessage: string | null };
type Configuration = { encryptionReady: boolean; company: CompanyConfiguration; facilities: FacilityConfiguration[] };
type Door = { indexCode: string; name: string };
type AccessInspection = { version: { product: string; version: string } | null; versionError: string | null; accessLevels: { id: string; name: string; resourceIds: string[]; resourceNames: string[] }[]; organizations: { indexCode: string; name: string; parentIndexCode: string | null }[]; organizationError: string | null };

function statusTone(status: string) { return status === "CONNECTED" ? "positive" : status === "DEGRADED" ? "warning" : "neutral"; }
function statusLabel(status: string) { return status === "CONNECTED" ? "Door API reachable" : status === "DEGRADED" ? "Connection failed" : status === "CONFIGURED" ? "Ready to test" : "Configuration required"; }

export function HikvisionIntegrationWorkspace() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [canManageCompany, setCanManageCompany] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [discoveredDoors, setDiscoveredDoors] = useState<Door[]>([]);
  const [accessInspection, setAccessInspection] = useState<AccessInspection | null>(null);
  const doorCodesField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/integrations/hikvision", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) { setError(payload.error?.message ?? "Hikvision configuration could not be loaded."); return; }
        setConfiguration(payload.data); setCanManage(payload.meta.canManage); setCanManageCompany(payload.meta.canManageCompany === true); setFacilityId(payload.data.facilities[0]?.id || ""); setError("");
      });
    return () => { cancelled = true; };
  }, []);
  const facility = useMemo(() => configuration?.facilities.find((item) => item.id === facilityId), [configuration, facilityId]);
  const temporaryMapping = facility?.organisationIndexCode.toUpperCase().startsWith("TEMP-") ?? false;
  const block24Doors = discoveredDoors.filter((door) => ["Block24 Main Gate_Door_1", "Block24 Entrance_Door_1", "Block24 Exit_Door_1"].includes(door.name));

  async function call(method: "PUT" | "POST", body: Record<string, unknown>, success: string) {
    setBusy(String(body.action)); setError(""); setNotice("");
    const response = await fetch("/api/v1/integrations/hikvision", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json(); setBusy("");
    if (!response.ok) { setError(payload.error?.message ?? payload.data?.message ?? "The Hikvision action failed."); if (payload.configuration) setConfiguration(payload.configuration); return; }
    if (payload.data?.facilities) setConfiguration(payload.data); else if (payload.configuration) setConfiguration(payload.configuration);
    setNotice(success);
  }

  function saveCredentials(formData: FormData) {
    const pinnedCertSha256Fingerprint = String(formData.get("pinnedCertSha256Fingerprint") ?? "").trim();
    const regionIndexCode = String(formData.get("regionIndexCode") ?? "").trim();
    void call("PUT", { action: "save-credentials", payload: { endpoint: String(formData.get("endpoint") ?? ""), userId: String(formData.get("userId") ?? "").trim() || undefined, appKey: String(formData.get("appKey") ?? "") || undefined, appSecret: String(formData.get("appSecret") ?? "") || undefined, pinnedCertSha256Fingerprint: pinnedCertSha256Fingerprint || undefined, regionIndexCode: regionIndexCode || undefined } }, "HikCentral credentials saved securely. Test a facility connection next.");
  }

  function saveMapping(formData: FormData) {
    const doorIndexCodes = String(formData.get("doorIndexCodes") ?? "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    void call("PUT", { action: "save-mapping", payload: { facilityId, organisationIndexCode: String(formData.get("organisationIndexCode") ?? ""), doorIndexCodes } }, "Facility and door mapping saved. Test the connection before using facial access.");
  }

  async function discoverDoors() {
    setBusy("discover-doors"); setError(""); setNotice(""); setDiscoveredDoors([]);
    try {
      const response = await fetch("/api/v1/integrations/hikvision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "discover-doors", facilityId }) });
      const payload = await response.json();
      if (!response.ok || !payload.data?.ok) throw new Error(payload.error?.message ?? payload.data?.message ?? "HikCentral door lookup failed.");
      if (!Array.isArray(payload.data.data?.doors)) throw new Error("HikCentral returned an invalid door list.");
      setDiscoveredDoors(payload.data.data.doors);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HikCentral door lookup failed."); }
    finally { setBusy(""); }
  }

  async function inspectAccess() {
    setBusy("inspect-access"); setError(""); setAccessInspection(null);
    try {
      const response = await fetch("/api/v1/integrations/hikvision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "inspect-access", facilityId }) });
      const payload = await response.json();
      if (!response.ok || !payload.data?.ok) throw new Error(payload.error?.message ?? payload.data?.message ?? "HikCentral access lookup failed.");
      setAccessInspection(payload.data.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "HikCentral access lookup failed."); }
    finally { setBusy(""); }
  }

  function addBlock24Doors() {
    if (block24Doors.length !== 3 || !doorCodesField.current) return;
    const existing = doorCodesField.current.value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    doorCodesField.current.value = [...new Set([...existing, ...block24Doors.map((door) => door.indexCode)])].join("\n");
    setNotice("Three Block24 codes added to the form. Save the mapping after checking the facility.");
  }

  return <div className="page-stack provider-config-workspace">
    <PageHeader eyebrow="Company setup · Integrations" title="Hikvision access control" description="Check the HikCentral connection and map the facility doors. Facial enrolment and live gate access require separate provider verification." />
    {error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p className="form-success"><CheckCircle2 size={16}/>{notice}</p> : null}
    {!configuration?.encryptionReady ? <p className="safe-config-note"><LockKeyhole size={17}/>Secure credential storage is not enabled on the server yet. Add the encryption key before entering the HikCentral App Key or App Secret.</p> : null}
    <section className="summary-strip">
      <div className="summary-cell"><span>Provider</span><strong>Hikvision</strong></div>
      <div className="summary-cell"><span>Company credentials</span><strong>{configuration?.company.appSecretConfigured ? "Saved" : "Required"}</strong></div>
      <div className="summary-cell"><span>Saved mappings</span><strong>{configuration?.facilities.filter((item) => item.organisationIndexCode && !item.organisationIndexCode.toUpperCase().startsWith("TEMP-") && item.doorIndexCodes.length).length ?? 0}/{configuration?.facilities.length ?? 0}</strong></div>
      <div className="summary-cell"><span>Connection state</span><strong>{statusLabel(facility?.status ?? configuration?.company.status ?? "DISCONNECTED")}</strong></div>
    </section>
    <section className="hikvision-layout">
      <form action={saveCredentials} className="panel panel-spacious company-form">
        <div className="panel-heading"><div><p className="eyebrow">Company connection</p><h2>HikCentral OpenAPI credentials</h2><p className="panel-subtitle">Secrets are encrypted before storage and are never returned to this page.</p></div><KeyRound className="positive-icon"/></div>
        <div className="field-grid">
          <label>HikCentral server address<input name="endpoint" type="url" required placeholder="https://hikcentral.example.co.za" defaultValue={configuration?.company.endpoint ?? ""} disabled={!canManageCompany}/></label>
          <label>HikCentral API user ID<input name="userId" type="text" maxLength={32} placeholder="User ID supplied for OpenAPI" defaultValue={configuration?.company.userId ?? ""} disabled={!canManageCompany}/></label>
          <label>App Key<input name="appKey" type="password" autoComplete="new-password" placeholder={configuration?.company.appKeyConfigured ? "Saved — leave blank to keep" : "Enter App Key"} disabled={!canManageCompany}/></label>
          <label>App Secret<input name="appSecret" type="password" autoComplete="new-password" placeholder={configuration?.company.appSecretConfigured ? "Saved — leave blank to keep" : "Enter App Secret"} disabled={!canManageCompany}/></label>
          <label>TLS certificate pin (SHA-256 fingerprint) — optional<input name="pinnedCertSha256Fingerprint" type="text" spellCheck={false} placeholder="AA:BB:CC:...(32 byte pairs)" defaultValue={configuration?.company.pinnedCertSha256Fingerprint ?? ""} disabled={!canManageCompany}/></label>
          <label>HikCentral region index code — optional<input name="regionIndexCode" type="text" spellCheck={false} placeholder="Enter only if provided by HikCentral" defaultValue={configuration?.company.regionIndexCode ?? ""} disabled={!canManageCompany}/></label>
        </div>
        <p className="safe-config-note"><ShieldCheck size={17}/>Saving replacement credentials automatically removes the previous usable values. Audit records contain only the endpoint and whether credentials are configured.</p>
        <p className="field-help">Only needed when the HikCentral server uses a self-signed certificate that can&apos;t be validated normally (for example, issued to an internal address rather than its public one). Enter the exact SHA-256 fingerprint of that certificate, confirmed from a trusted source such as the server itself — this pins the connection to that specific certificate instead of doing normal hostname validation. It is not a secret. Leave blank if the server has a certificate from a recognised authority.</p>
        <p className="field-help">The standard door lookup does not need a region index code. Enter one only for a separate region-scoped integration supplied by the installer.</p>
        <div className="form-footer"><button className="button button-primary" disabled={!canManageCompany || !configuration?.encryptionReady || busy === "save-credentials"}>{busy === "save-credentials" ? "Saving…" : "Save credentials"}</button></div>
      </form>
      <form action={saveMapping} className="panel panel-spacious company-form" key={facility?.id ?? "none"}>
        <div className="panel-heading"><div><p className="eyebrow">Facility mapping</p><h2>Organisation and doors</h2><p className="panel-subtitle">These are the intended doors for this facility. Saving them does not grant access to a person.</p></div><Link2 className="positive-icon"/></div>
        <label className="facility-picker hikvision-facility-picker"><span>Facility</span><select value={facilityId} onChange={(event) => { setFacilityId(event.target.value); setDiscoveredDoors([]); setNotice(""); setError(""); }}>{configuration?.facilities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="field-grid">
          <label>HikCentral organisation index code<input name="organisationIndexCode" required defaultValue={facility?.organisationIndexCode ?? ""} disabled={!canManage}/></label>
          <label>Door index codes<textarea ref={doorCodesField} name="doorIndexCodes" required rows={6} defaultValue={facility?.doorIndexCodes.join("\n") ?? ""} placeholder={'One door code per line\ne.g. midpoint-main-entry'} disabled={!canManage}/></label>
        </div>
        {temporaryMapping ? <p className="safe-config-note" role="alert">TEMP-CONNECTION-TEST is a placeholder, not a verified HikCentral department. The saved door list predates the three Block24 readers. Check the live department and doors before using this mapping for a person.</p> : null}
        <p className="field-help">Use HikCentral index codes, not the visible door names. Duplicate codes are removed automatically.</p>
        <div className="hikvision-actions"><button type="button" className="button button-secondary" disabled={!canManage || !facilityId || busy === "discover-doors"} onClick={() => void discoverDoors()}>{busy === "discover-doors" ? "Finding doors…" : "Find Block24 door IDs"}</button>{block24Doors.length === 3 ? <button type="button" className="button button-secondary" onClick={addBlock24Doors}>Add all three to mapping</button> : null}</div>
        {discoveredDoors.length ? <div className="field-help" aria-live="polite">{block24Doors.length === 3 ? block24Doors.map((door) => <div key={door.indexCode}>{door.name}: <code>{door.indexCode}</code></div>) : "All three Block24 doors were not found in the live HikCentral door list. Confirm their names and IDs before saving."}</div> : null}
        <div className="hikvision-actions"><button className="button button-secondary" disabled={!canManage || !facilityId || busy === "save-mapping"}>{busy === "save-mapping" ? "Saving…" : "Save mapping"}</button><button type="button" className="button button-primary" disabled={!canManage || !facilityId || busy === "test-connection"} onClick={() => void call("POST", { action: "test-connection", facilityId }, "HikCentral door-list connection verified. Person and gate access are not yet verified.")}><RefreshCw size={15}/>{busy === "test-connection" ? "Testing…" : "Test connection"}</button><button type="button" className="button button-secondary" disabled={!canManage || !facilityId || Boolean(busy)} onClick={() => void inspectAccess()}>{busy === "inspect-access" ? "Checking…" : "Check version and access levels"}</button></div>
        {accessInspection ? <div className="field-help" aria-live="polite"><strong>{accessInspection.version ? `${accessInspection.version.product} ${accessInspection.version.version}` : "Platform version unavailable"}</strong>{accessInspection.versionError ? <div>{accessInspection.versionError}</div> : null}<div>{accessInspection.organizations.length} HikCentral departments found. Use the verified STOR24 department index code above; this check does not create one.</div>{accessInspection.organizationError ? <div>{accessInspection.organizationError}</div> : accessInspection.organizations.map(org => <div key={org.indexCode}>{org.name}: <code>{org.indexCode}</code></div>)}<div>{accessInspection.accessLevels.length} access levels found. Check the three Block24 resources before enrolment.</div>{accessInspection.accessLevels.map((level) => <div key={level.id}>{level.name} ({level.id}): {level.resourceIds.map((id, index) => `${level.resourceNames[index] || "name unavailable"} (${id})`).join(", ") || "no resources"}</div>)}</div> : null}
        <div className="hikvision-health"><StatusPill tone={statusTone(facility?.status ?? "DISCONNECTED")}>{statusLabel(facility?.status ?? "DISCONNECTED")}</StatusPill><span>{facility?.lastSuccessAt ? `Last successful check ${new Date(facility.lastSuccessAt).toLocaleString("en-ZA")}` : facility?.failureMessage ?? "No successful live check yet."}</span></div>
      </form>
    </section>
  </div>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Link2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { BLOCK24_FACE_DOORS, MIDPOINT_NON_TENANT_DOORS, STOR24_FACE_DOORS } from "@/lib/integrations/hikcentral-door-scope";

type CompanyConfiguration = { endpoint: string; userId: string; appKeyConfigured: boolean; appSecretConfigured: boolean; pinnedCertSha256Fingerprint: string; regionIndexCode: string; status: string; lastHealthAt: string | null; lastSuccessAt: string | null; failureMessage: string | null };
type FacilityConfiguration = { id: string; name: string; code: string; organisationIndexCode: string; doorIndexCodes: string[]; accessLevelIds: string[]; nightlyClearanceRequired: boolean; status: string; lastHealthAt: string | null; lastSuccessAt: string | null; failureMessage: string | null };
type Configuration = { encryptionReady: boolean; company: CompanyConfiguration; facilities: FacilityConfiguration[] };
type Door = { indexCode: string; name: string };
type AccessInspection = { version: { product: string; version: string } | null; versionError: string | null; accessLevels: { id: string; name: string; resourceIds: string[]; resourceNames: string[] }[]; organizations: { indexCode: string; name: string; parentIndexCode: string | null }[]; organizationError: string | null };
type LockPolicy = { facilityId: string; approvalReference: string; warningText: string; lockedText: string; noticeHours: number };

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
  const [lockPolicy, setLockPolicy] = useState<LockPolicy | null>(null);
  const organisationField = useRef<HTMLInputElement>(null);
  const doorCodesField = useRef<HTMLTextAreaElement>(null);
  const accessLevelsField = useRef<HTMLTextAreaElement>(null);

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
  useEffect(() => {
    if (!facilityId) return;
    const controller = new AbortController();
    void fetch(`/api/v1/access/hikcentral-lock-policy?${new URLSearchParams({ facilityId })}`, { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(body => { if (body) setLockPolicy(body.data); }).catch(() => {});
    return () => controller.abort();
  }, [facilityId]);
  const temporaryMapping = facility?.organisationIndexCode.toUpperCase().startsWith("TEMP-") ?? false;
  const block24Doors = discoveredDoors.filter((door) => ["Block24 Main Gate_Door_1", "Block24 Entrance_Door_1", "Block24 Exit_Door_1"].includes(door.name));
  const approvedScope = accessInspection?.organizations.some(org => org.name === "STOR24" && org.indexCode === "97") && [["Block24", "12", BLOCK24_FACE_DOORS], ["DRIVERS", "7", MIDPOINT_NON_TENANT_DOORS]].every(([name, id, doors]) => {
    const level = accessInspection.accessLevels.find(item => item.name === name && item.id === id);
    return level && level.resourceIds.length === doors.length && level.resourceIds.every(resource => doors.includes(resource));
  });

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
    const accessLevelIds = String(formData.get("accessLevelIds") ?? "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
    void call("PUT", { action: "save-mapping", payload: { facilityId, organisationIndexCode: String(formData.get("organisationIndexCode") ?? ""), doorIndexCodes, accessLevelIds, nightlyClearanceRequired: formData.get("nightlyClearanceRequired") === "on" } }, "Facility and door mapping saved. Check the exact access-level resources before granting facial access.");
  }

  async function saveLockPolicy(formData: FormData) {
    setBusy("save-lock-policy"); setError(""); setNotice("");
    try {
      const payload = { facilityId, approvalReference: String(formData.get("approvalReference") ?? ""), warningText: String(formData.get("warningText") ?? ""), lockedText: String(formData.get("lockedText") ?? ""), noticeHours: Number(formData.get("noticeHours")) };
      const response = await fetch("/api/v1/access/hikcentral-lock-policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message ?? "Lock notice policy could not be saved.");
      setLockPolicy(body.data); setNotice("Approved lock notice wording and lead time saved. Delivery still requires a verified customer phone and Twilio status readback.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Lock notice policy could not be saved."); }
    finally { setBusy(""); }
  }

  async function disableLockPolicy() {
    setBusy("disable-lock-policy"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/v1/access/hikcentral-lock-policy?${new URLSearchParams({ facilityId })}`, { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw Error("Lockout notice policy could not be disabled.");
      setLockPolicy(null); setNotice("Automatic non-payment lockouts disabled for this facility.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Lockout notice policy could not be disabled."); }
    finally { setBusy(""); }
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

  function useBlock24Doors() {
    if (block24Doors.length !== 3 || !doorCodesField.current) return;
    doorCodesField.current.value = block24Doors.map((door) => door.indexCode).join("\n");
    setNotice("Draft door list replaced with the three Block24 doors. Confirm the real department and any approved Midpoint route before saving.");
  }

  function useApprovedScope() {
    if (!approvedScope || !organisationField.current || !doorCodesField.current || !accessLevelsField.current) return;
    organisationField.current.value = "97";
    doorCodesField.current.value = STOR24_FACE_DOORS.join("\n");
    accessLevelsField.current.value = "12\n7";
    setNotice("Verified STOR24, Block24 and Midpoint non-tenant IDs filled in. Confirm the nightly empty-site process, then save the mapping.");
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
        <label className="facility-picker hikvision-facility-picker"><span>Facility</span><select value={facilityId} onChange={(event) => { setFacilityId(event.target.value); setDiscoveredDoors([]); setAccessInspection(null); setNotice(""); setError(""); }}>{configuration?.facilities.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="field-grid">
          <label>HikCentral organisation index code<input ref={organisationField} name="organisationIndexCode" required defaultValue={facility?.organisationIndexCode ?? ""} disabled={!canManage}/></label>
          <label>Door index codes<textarea ref={doorCodesField} name="doorIndexCodes" required rows={6} defaultValue={facility?.doorIndexCodes.join("\n") ?? ""} placeholder={'One door code per line\ne.g. midpoint-main-entry'} disabled={!canManage}/></label>
          <label>Face access level IDs<textarea ref={accessLevelsField} name="accessLevelIds" rows={2} defaultValue={facility?.accessLevelIds.join("\n") ?? ""} placeholder={'Block24 level ID\nMidpoint non-tenant level ID'} disabled={!canManage}/></label>
        </div>
        <label className="field-help"><input type="checkbox" name="nightlyClearanceRequired" defaultChecked={facility?.nightlyClearanceRequired ?? false} disabled={!canManage} /> Block24 non-payment lockouts require staff to confirm the site is empty after 19:00 SAST each night. Midpoint has a guest exit.</label>
        {temporaryMapping ? <p className="safe-config-note" role="alert">TEMP-CONNECTION-TEST is a placeholder, not a verified HikCentral department. The saved door list predates the three Block24 readers. Check the live department and doors before using this mapping for a person.</p> : null}
        <p className="field-help">Use Block24 level 12 and the verified Midpoint non-tenant DRIVERS level 7, with exactly their 16 listed door IDs. The existing “Midpoint Access” level 9 includes tenant and control-room points and is refused. Confirm nightly empty-site clearance before saving; the live group resources are checked again before each grant.</p>
        <div className="hikvision-actions"><button type="button" className="button button-secondary" disabled={!canManage || !facilityId || busy === "discover-doors"} onClick={() => void discoverDoors()}>{busy === "discover-doors" ? "Finding doors…" : "Find Block24 door IDs"}</button>{block24Doors.length === 3 ? <button type="button" className="button button-secondary" onClick={useBlock24Doors}>Replace draft with Block24 doors</button> : null}</div>
        {discoveredDoors.length ? <div className="field-help" aria-live="polite">{block24Doors.length === 3 ? block24Doors.map((door) => <div key={door.indexCode}>{door.name}: <code>{door.indexCode}</code></div>) : "All three Block24 doors were not found in the live HikCentral door list. Confirm their names and IDs before saving."}</div> : null}
        <div className="hikvision-actions"><button className="button button-secondary" disabled={!canManage || !facilityId || busy === "save-mapping"}>{busy === "save-mapping" ? "Saving…" : "Save mapping"}</button><button type="button" className="button button-primary" disabled={!canManage || !facilityId || busy === "test-connection"} onClick={() => void call("POST", { action: "test-connection", facilityId }, "HikCentral door-list connection verified. Person and gate access are not yet verified.")}><RefreshCw size={15}/>{busy === "test-connection" ? "Testing…" : "Test connection"}</button><button type="button" className="button button-secondary" disabled={!canManage || !facilityId || Boolean(busy)} onClick={() => void inspectAccess()}>{busy === "inspect-access" ? "Checking…" : "Check version and access levels"}</button></div>
        {approvedScope ? <button type="button" className="button button-secondary" disabled={!canManage} onClick={useApprovedScope}>Fill verified STOR24 and non-tenant scope</button> : null}
        {accessInspection ? <div className="field-help" aria-live="polite"><strong>{accessInspection.version ? `${accessInspection.version.product} ${accessInspection.version.version}` : "Platform version unavailable"}</strong>{accessInspection.versionError ? <div>{accessInspection.versionError}</div> : null}<div>{accessInspection.organizations.length} HikCentral departments found. Use the verified STOR24 department index code above; this check does not create one.</div>{accessInspection.organizationError ? <div>{accessInspection.organizationError}</div> : accessInspection.organizations.map(org => <div key={org.indexCode}>{org.name}: <code>{org.indexCode}</code></div>)}<div>{accessInspection.accessLevels.length} access levels found. Check the three Block24 resources before enrolment.</div>{accessInspection.accessLevels.map((level) => <div key={level.id}>{level.name} ({level.id}): {level.resourceIds.map((id, index) => `${level.resourceNames[index] || "name unavailable"} (${id})`).join(", ") || "no resources"}</div>)}</div> : null}
        <div className="hikvision-health"><StatusPill tone={statusTone(facility?.status ?? "DISCONNECTED")}>{statusLabel(facility?.status ?? "DISCONNECTED")}</StatusPill><span>{facility?.lastSuccessAt ? `Last successful check ${new Date(facility.lastSuccessAt).toLocaleString("en-ZA")}` : facility?.failureMessage ?? "No successful live check yet."}</span></div>
      </form>
      <form action={saveLockPolicy} className="panel panel-spacious company-form" key={`lock-policy-${facilityId}-${lockPolicy?.approvalReference ?? "draft"}`}>
        <div className="panel-heading"><div><p className="eyebrow">Non-payment notices</p><h2>Approved lockout wording</h2><p className="panel-subtitle">Add Liezl&apos;s exact approval reference, warning, locked notice and minimum warning period when the document is supplied. Until then, automatic non-payment locks remain held.</p></div></div>
        <p>{lockPolicy ? `Approved reference: ${lockPolicy.approvalReference}` : "No approved lockout notice configured."}</p>
        <div className="field-grid"><label>Approval document reference<input name="approvalReference" required minLength={8} maxLength={240} defaultValue={lockPolicy?.approvalReference ?? ""} disabled={!canManageCompany} /></label><label>Minimum hours after confirmed delivery<input name="noticeHours" type="number" min={1} max={168} required defaultValue={lockPolicy?.noticeHours ?? ""} disabled={!canManageCompany} /></label></div>
        <label>Warning SMS text<textarea name="warningText" required minLength={40} maxLength={1200} rows={4} defaultValue={lockPolicy?.warningText ?? ""} disabled={!canManageCompany} /></label><p className="field-help">Use {"{account}"} and {"{lockDate}"} in the approved warning.</p>
        <label>Locked SMS text<textarea name="lockedText" required minLength={40} maxLength={1200} rows={4} defaultValue={lockPolicy?.lockedText ?? ""} disabled={!canManageCompany} /></label><p className="field-help">Use {"{account}"} in the approved locked notice. The system needs a verified mobile number and confirmed Twilio delivery before a non-payment lock.</p>
        <div className="form-footer"><button className="button button-primary" disabled={!canManageCompany || busy === "save-lock-policy"}>{busy === "save-lock-policy" ? "Saving…" : "Save approved notice policy"}</button>{lockPolicy ? <button className="button button-secondary" type="button" disabled={!canManageCompany || Boolean(busy)} onClick={() => void disableLockPolicy()}>Disable lockout policy</button> : null}</div>
      </form>
    </section>
  </div>;
}

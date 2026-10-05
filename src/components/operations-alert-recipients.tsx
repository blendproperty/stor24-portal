"use client";

import { useEffect, useState } from 'react';
import { BellRing, Mail, MessageCircle, Plus, Smartphone, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { validateAlertRecipients, type AlertRecipient, type AlertChannel } from '@/lib/operations-alert-policy.mjs';

type Saved = { recipients: AlertRecipient[]; revision: string | null };
const endpoint = '/api/v1/operations/alert-recipients';
const channels = [['EMAIL', 'Email', Mail], ['SMS', 'SMS', Smartphone], ['WHATSAPP', 'WhatsApp', MessageCircle]] as const;
async function fetchSaved(signal: AbortSignal): Promise<Saved> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload.data?.recipients) || !('revision' in payload.data)) throw Error('The recipient list could not be loaded.');
  return payload.data;
}
export function OperationsAlertRecipients() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const dirty = saved !== null && JSON.stringify(saved.recipients) !== JSON.stringify(recipients);
  async function load() {
    setBusy(true); setError('');
    try {
      const data = await fetchSaved(AbortSignal.timeout(20_000));
      setSaved(data); setRecipients(data.recipients); setUncertain(false); setNotice('');
    } catch { setError('The recipient list could not be loaded. Try loading it again.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetchSaved(AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]))
      .then(data => { if (!controller.signal.aborted) { setSaved(data); setRecipients(data.recipients); } })
      .catch(() => { if (!controller.signal.aborted) setError('The recipient list could not be loaded. Try loading it again.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = (id: string, patch: Partial<AlertRecipient>) => { setRecipients(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row)); setNotice(''); };
  function toggle(id: string, channel: AlertChannel) {
    const row = recipients.find(r => r.id === id)!;
    update(id, { channels: row.channels.includes(channel) ? row.channels.filter(c => c !== channel) : [...row.channels, channel] });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!saved || busy || uncertain) return;
    let validated;
    try { validated = validateAlertRecipients(recipients); } catch (err) { setError(err instanceof Error ? err.message : 'Review the recipient details.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients: validated, revision: saved.revision }), signal: AbortSignal.timeout(20_000) });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409) setUncertain(true);
        setError(payload.error?.message || 'The list could not be saved.'); return;
      }
      if (!Array.isArray(payload.data?.recipients) || typeof payload.data.revision !== 'string') throw Error('Unconfirmed save');
      setSaved(payload.data); setRecipients(payload.data.recipients); setNotice('Recipients saved. The monitor will use this list after its next successful check.');
    } catch { setUncertain(true); setError('We could not confirm whether the save finished. Reload the saved list before making another change.'); }
    finally { setBusy(false); }
  }
  return <div className="page-stack alert-recipient-workspace">
    <PageHeader eyebrow="Administration · Monitoring" title="Operations alerts" description="Choose who receives website, backup and resource failure alerts, plus recovery notices." />
    <section className="panel panel-spacious"><div className="panel-heading"><div><h2>Response team</h2><p className="panel-subtitle">Only organisation owners can change this list.</p></div><BellRing size={24} /></div>
      <p className="alert-recipient-note">Changes take effect after the next successful monitoring check. During an outage, alerts use the last saved list available to the monitor. Keep at least one active recipient.</p>
      {error && <div className="alert-recipient-error" role="alert">{error}</div>}
      {notice && <p className="alert-recipient-notice" role="status">{notice}</p>}
      {!saved ? <button className="button button-secondary" disabled={busy} onClick={() => void load()}>{busy ? 'Loading recipients…' : 'Load recipients again'}</button> : <form onSubmit={save}>
        <fieldset disabled={busy || uncertain} className="alert-recipient-fieldset">
          <div className="alert-recipient-list">{recipients.map((row, i) => <section className={`alert-recipient-card ${row.enabled ? '' : 'is-paused'}`} key={row.id} aria-label={`Recipient ${i + 1}`}>
            <div className="alert-recipient-heading"><h3>{row.name || `New recipient ${i + 1}`}</h3><label className="alert-recipient-check"><input type="checkbox" checked={row.enabled} onChange={e => update(row.id, { enabled: e.target.checked })} />{row.enabled ? 'Active' : 'Paused'}</label></div>
            <div className="alert-recipient-fields"><label>Name<input maxLength={80} value={row.name} onChange={e => update(row.id, { name: e.target.value })} autoComplete="off" /></label><label>Email address<input type="email" maxLength={254} value={row.email} onChange={e => update(row.id, { email: e.target.value })} autoComplete="off" /></label><label>Mobile number<input type="tel" maxLength={16} placeholder="+27817088120" value={row.mobile} onChange={e => update(row.id, { mobile: e.target.value })} autoComplete="off" /></label></div>
            <div className="alert-recipient-channels">{channels.map(([channel, label, Icon]) => <label key={channel}><input type="checkbox" checked={row.channels.includes(channel)} onChange={() => toggle(row.id, channel)} /><Icon size={16} />{label}</label>)}</div>
            <div className="alert-recipient-footer"><label className="alert-recipient-check"><input type="checkbox" checked={row.consent} onChange={e => update(row.id, { consent: e.target.checked })} />This person has agreed to receive operations alerts.</label><button type="button" className="button button-secondary" aria-label={`Remove ${row.name || 'recipient'}`} onClick={() => { setRecipients(rows => rows.filter(r => r.id !== row.id)); setNotice(''); }}><Trash2 size={15} />Remove</button></div>
          </section>)}</div>
          <div className="alert-recipient-actions"><button type="button" className="button button-secondary" disabled={recipients.length >= 20} onClick={() => setRecipients(rows => [...rows, { id: crypto.randomUUID(), name: '', email: '', mobile: '', channels: ['EMAIL'], enabled: true, consent: false }])}><Plus size={16} />Add recipient</button><button type="submit" className="button button-primary" disabled={!dirty}>{busy ? 'Saving…' : 'Save recipients'}</button></div>
        </fieldset>
        {uncertain && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void load()}>Reload saved list</button>}
        {dirty && !uncertain && <p className="alert-recipient-note">You have unsaved changes.</p>}
      </form>}
    </section>
  </div>;
}

'use client';
import { useEffect, useState } from 'react';

type Facility = { id: string; name: string };
type User = { id: string; name: string; email: string };
type Connection = { id: string; facilityId: string | null; channel: string; botId: string | null };
export function SocialProvisionForm() {
  const [facilities, setFacilities] = useState<Facility[]>([]), [users, setUsers] = useState<User[]>([]);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [facilityId, setFacility] = useState(''), [recipientUserId, setRecipient] = useState('');
  const [facebookBotId, setFacebook] = useState(''), [instagramBotId, setInstagram] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [keys, setKeys] = useState<{ facebook: string; instagram: string } | null>(null);
  useEffect(() => { void fetch('/api/v1/integrations/whatchimp-social', { cache: 'no-store' }).then(async r => { if (!r.ok) throw Error(); const p = await r.json(); setFacilities(p.data.facilities); setUsers(p.data.users); setConnections(p.data.connections); }).catch(() => setMessage('Could not load facilities and staff.')); }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    const recipient = users.find(u => u.id === recipientUserId); if (!recipient) return;
    setBusy(true); setMessage(''); setConnections(null);
    try {
      const r = await fetch('/api/v1/integrations/whatchimp-social', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facilityId, recipientUserId, recipientEmail: recipient.email, facebookBotId, instagramBotId }) });
      const p = await r.json(); if (!r.ok) { setMessage(r.status >= 500 ? 'The result is uncertain. Do not retry until the connections have been reviewed.' : (p.error?.message || 'Could not create the credentials.')); return; }
      setKeys(p.data);
    } catch { setMessage('The result is uncertain. Do not retry until the connections have been reviewed.'); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!facilityId || !facebookBotId || !instagramBotId || !window.confirm('Revoke both matching credentials? The connected enquiry flows will stop working.')) return;
    setBusy(true); setMessage(''); setConnections(null);
    try {
      const r = await fetch('/api/v1/integrations/whatchimp-social', { method: 'DELETE', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facilityId, facebookBotId, instagramBotId }) });
      const p = await r.json(); setMessage(r.ok ? 'Both matching credentials were revoked.' : (p.error?.message || 'Could not revoke the credentials.'));
    } catch { setMessage('The result is uncertain. Check the connections before retrying.'); }
    finally { setBusy(false); }
  }
  return <section className="panel panel-spacious social-provision">
    {message && <p role="alert">{message}</p>}
    <p className="social-provision-status">Active connections: {connections === null ? 'not checked; reload this page to check' : connections.length ? connections.map(c => `${facilities.find(f => f.id === c.facilityId)?.name || 'Unknown facility'} — ${c.channel} (${c.botId || 'unknown bot'})`).join('; ') : 'none'}.</p>
    {keys ? <div className="social-provision-keys"><p>Copy each key privately into its matching WhatChimp request. The keys are shown only here; they cannot be recovered after leaving this page.</p><label>Facebook key<input readOnly value={keys.facebook} /></label><label>Instagram key<input readOnly value={keys.instagram} /></label><button type="button" className="button" onClick={() => setKeys(null)}>Done</button></div> : <form onSubmit={create}>
      <p>Create separate credentials for lead capture. Each key permits enquiry creation for the selected facility.</p>
      <div className="social-provision-fields">
      <label>Facility<select required value={facilityId} onChange={e => setFacility(e.target.value)}><option value="">Choose a facility</option>{facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label>Notification recipient<select required value={recipientUserId} onChange={e => setRecipient(e.target.value)}><option value="">Choose a recipient</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select></label>
      <label>Facebook bot ID<input required value={facebookBotId} onChange={e => setFacebook(e.target.value)} /></label>
      <label>Instagram bot ID<input required value={instagramBotId} onChange={e => setInstagram(e.target.value)} /></label>
      </div>
      <div className="social-provision-actions"><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create separate credentials'}</button>
      <button type="button" className="button" disabled={busy} onClick={revoke}>Revoke matching credentials</button></div>
    </form>}
  </section>;
}

'use client';
import { useEffect, useState } from 'react';

type Choice = { id: string; name: string; email?: string };
type Settings = { facilities: Choice[]; users: Choice[]; connections: { facilityId: string; recipientUserId: string | null }[] };

export function WhatChimpRecipientForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [facility, setFacility] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('Loading settings…');
  useEffect(() => { fetch('/api/v1/integrations/whatchimp-enquiry-recipient', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(body => { setSettings(body.data); setMessage(''); }).catch(() => setMessage('Could not load the WhatsApp settings.')); }, []);
  async function save() {
    setMessage('Saving…');
    try {
      const response = await fetch('/api/v1/integrations/whatchimp-enquiry-recipient', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facilityId: facility, recipientUserId: recipient }) });
      if (!response.ok) throw Error();
      const refreshed = await fetch('/api/v1/integrations/whatchimp-enquiry-recipient', { cache: 'no-store' });
      if (!refreshed.ok) throw Error();
      const data: Settings = (await refreshed.json()).data;
      setSettings(data);
      if (!data.connections.some(c => c.facilityId === facility && c.recipientUserId === recipient)) throw Error();
      setMessage('Recipient saved.');
    } catch { setMessage('Could not save. Check the facility and recipient permissions.'); }
  }
  return <section className="panel panel-spacious social-provision"><h2>WhatsApp enquiry follow-up</h2><p>Choose who receives new WhatsApp enquiries for a connected store.</p>
    <div className="social-provision-fields"><label>Store <select value={facility} onChange={e => { setFacility(e.target.value); setRecipient(settings?.connections.find(c => c.facilityId === e.target.value)?.recipientUserId ?? ''); }}><option value="">Select a connected store</option>{settings?.facilities.filter(f => settings.connections.some(c => c.facilityId === f.id)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label>Assigned recipient <select value={recipient} onChange={e => setRecipient(e.target.value)}><option value="">Select a person</option>{settings?.users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select></label></div>
    <div className="social-provision-actions"><button type="button" className="button button-primary" disabled={!facility || !recipient || message === 'Saving…'} onClick={save}>Save recipient</button></div><p role="status">{message}</p>
  </section>;
}

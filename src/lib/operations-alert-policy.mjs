export const MAX_ALERT_RECIPIENTS = 20;
export function validateAlertRecipients(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ALERT_RECIPIENTS) throw new Error('Use between 1 and 20 recipients.');
  const ids = new Set(), destinations = new Set();
  const recipients = value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['id', 'name', 'email', 'mobile', 'channels', 'enabled', 'consent'].includes(k))) throw new Error('Invalid recipient details.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id || '') || ids.has(item.id)) throw new Error('Invalid or duplicate recipient.');
    ids.add(item.id);
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const email = typeof item.email === 'string' ? item.email.trim().toLowerCase() : '';
    const mobile = typeof item.mobile === 'string' ? item.mobile.trim() : '';
    if (!name || name.length > 80 || /[\r\n\x00-\x1f]/.test(name)) throw new Error('Enter a name of up to 80 characters.');
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a valid email address.');
    if (mobile && !/^\+[1-9]\d{7,14}$/.test(mobile)) throw new Error('Use an international mobile number, for example +27817088120.');
    if (typeof item.enabled !== 'boolean' || typeof item.consent !== 'boolean' || !Array.isArray(item.channels) || item.channels.length > 3 || new Set(item.channels).size !== item.channels.length || item.channels.some(c => !['EMAIL', 'SMS', 'WHATSAPP'].includes(c))) throw new Error('Choose valid notification channels.');
    if (item.channels.includes('EMAIL') && !email) throw new Error('Email alerts need an email address.');
    if (item.channels.some(c => c !== 'EMAIL') && !mobile) throw new Error('SMS and WhatsApp alerts need a mobile number.');
    if (item.enabled && (!item.channels.length || !item.consent)) throw new Error('Active recipients need a channel and permission to receive alerts.');
    if (item.enabled) for (const channel of item.channels) {
      const key = `${channel}:${channel === 'EMAIL' ? email : mobile}`;
      if (destinations.has(key)) throw new Error('The same address or number cannot receive a channel twice.');
      destinations.add(key);
    }
    return { id: item.id, name, email, mobile, channels: [...item.channels], enabled: item.enabled, consent: item.consent };
  });
  if (!recipients.some(r => r.enabled)) throw new Error('Keep at least one active alert recipient.');
  return recipients;
}

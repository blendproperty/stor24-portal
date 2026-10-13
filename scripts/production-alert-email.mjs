const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Table layout and inline styles keep the operational email readable in Outlook.
export function renderAlertEmail({ kind, severity, time, priority, timeframe, impact, remedy, rows }) {
  const state = kind === 'TEST' ? { colour: '#2459a6', background: '#edf3fc', title: 'Notification delivery test' }
    : kind === 'RECOVERY' ? { colour: '#16835f', background: '#e8f7f1', title: 'Checks recovered' }
    : severity === 'HIGH' ? { colour: '#bb3f3f', background: '#fff0f0', title: 'Urgent attention required' }
    : { colour: '#a96305', background: '#fff6df', title: 'Monitoring needs attention' };
  const monitor = rows.find(([label]) => label === 'Monitor')?.[1];
  const safeMonitor = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(monitor || '') ? monitor : null;
  const evidenceRows = rows.filter(([label]) => label !== 'Monitor').map(([label, value], i) => `<tr><th scope="row" width="30%" valign="top" style="padding:12px 16px;text-align:left;font-size:13px;font-weight:600;color:#667085;border-bottom:1px solid #e7eaf0;background:${i % 2 ? '#f6f7f9' : '#ffffff'}">${escape(label)}</th><td valign="top" style="padding:12px 16px;font-size:14px;line-height:21px;color:#172033;border-bottom:1px solid #e7eaf0;background:${i % 2 ? '#f6f7f9' : '#ffffff'}">${escape(value)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>STOR24 operations notification</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#172033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e7eaf0">
<tr><td style="padding:24px;background:#101a2f;border-top:5px solid #f36b21"><div style="font-size:28px;font-weight:800;letter-spacing:1px;color:#ffffff">STOR<span style="color:#f36b21">24</span></div><div style="margin-top:8px;font-size:12px;letter-spacing:2px;color:#d5dbe7">OPERATIONS NOTIFICATION</div></td></tr>
<tr><td style="padding:24px;background:${state.background};border-left:5px solid ${state.colour}"><div style="font-size:12px;font-weight:700;letter-spacing:1px;color:${state.colour}">${escape(kind)} &nbsp; / &nbsp; ${escape(severity)}</div><h1 style="margin:10px 0;font-size:25px;line-height:31px;color:#172033">${state.title}</h1><p style="margin:0;font-size:15px;line-height:23px">${escape(impact)}</p><p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#667085">Observed ${escape(time)}</p></td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 10px;font-size:17px">Recommended action</h2><p style="margin:0 0 12px;font-size:14px;line-height:22px">${escape(remedy)}</p><p style="margin:0;font-size:13px;line-height:21px"><strong>${escape(priority)}</strong> &middot; ${escape(timeframe)}</p></td></tr>
<tr><td style="padding:0 24px 24px"><h2 style="margin:0 0 12px;font-size:17px">Check details</h2><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e7eaf0;font-family:Arial,Helvetica,sans-serif">${evidenceRows}</table></td></tr>
${safeMonitor ? `<tr><td style="padding:0 24px 24px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#101a2f" style="padding:14px 20px"><a href="${escape(safeMonitor)}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">View monitor run &rarr;</a></td></tr></table><p style="margin:12px 0 0;font-size:12px;line-height:18px;word-break:break-all"><a href="${escape(safeMonitor)}" style="color:#2459a6">${escape(safeMonitor)}</a></p></td></tr>` : ''}
<tr><td style="padding:18px 24px;background:#f6f7f9;border-top:1px solid #e7eaf0;font-size:12px;line-height:19px;color:#667085">STOR24 automated monitoring<br>Response timeframes are suggested targets. Check results describe this observation; elapsed time between checks is not outage duration.</td></tr>
</table></td></tr></table></body></html>`;
}

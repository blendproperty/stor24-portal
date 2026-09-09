import { escapeEmailHtml } from "./email";

type InvitationEmailInput = { name: string; invitedByName: string; roleName: string; inviteUrl: string; expiresAt: Date };

export function invitationEmail(input: InvitationEmailInput) {
  const url = new URL(input.inviteUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid invitation URL");
  const expiry = new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(input.expiresAt);
  const safe = Object.fromEntries(Object.entries({ name: input.name, inviter: input.invitedByName, role: input.roleName, url: url.href, expiry, logo: `${url.origin}/brand/stor24-logo-email.png` }).map(([key, value]) => [key, escapeEmailHtml(value)]));
  return {
    subject: "Your space on the STOR24 team is ready",
    text: `Hi ${input.name},\n\n${input.invitedByName} has invited you to join the STOR24 workspace as ${input.roleName}.\n\nA little less admin. More room to get things done.\n\nAccept your invitation and set up your account: ${url.href}\n\nThis personal invitation expires on ${expiry} (South African time). Please do not forward it. If you were not expecting this invitation, you can ignore this email.\n\nSafe space. Smart storage. STOR24.`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your STOR24 invitation</title></head>
<body style="margin:0;padding:0;background:#f5f3ea;color:#071411;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your invitation to the STOR24 workspace is here. Let’s get you set up.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f3ea;"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;">
<tr><td style="height:7px;background:#ff5a0a;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 28px 24px;"><img src="${safe.logo}" alt="STOR24" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;"></td></tr>
<tr><td style="padding:0 28px 32px;">
<p style="margin:0 0 14px;color:#b63b00;font-size:11px;font-weight:bold;letter-spacing:2px;">WELCOME TO THE TEAM</p>
<h1 style="margin:0 0 20px;color:#071411;font-size:34px;line-height:1.12;letter-spacing:-1px;">Great things need<br>a little space.</h1>
<p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hi ${safe.name},</p>
<p style="margin:0 0 18px;color:#52615b;font-size:16px;line-height:1.6;">${safe.inviter} has invited you to join the STOR24 workspace. A little less admin. More room to get things done.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f3ea;border-radius:12px;"><tr><td style="padding:18px 20px;"><p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;color:#52615b;">YOUR ROLE</p><p style="margin:0;font-size:16px;font-weight:bold;color:#071411;">${safe.role}</p></td></tr></table>
<p style="margin:22px 0;color:#52615b;font-size:16px;line-height:1.6;">Your next step? Accept your invitation and set up your account.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#ff5a0a" style="border-radius:8px;"><a href="${safe.url}" style="display:inline-block;border:16px solid #ff5a0a;border-left-width:24px;border-right-width:24px;border-radius:8px;color:#071411;font-size:16px;font-weight:bold;text-decoration:none;">Accept invitation &rarr;</a></td></tr></table>
<p style="margin:22px 0 0;color:#52615b;font-size:13px;line-height:1.6;">Ready when you are. This invitation expires on <strong>${safe.expiry}</strong> (South African time).</p>
<p style="margin:14px 0 0;color:#52615b;font-size:12px;line-height:1.6;">Button not opening? <a href="${safe.url}" style="color:#9d3500;text-decoration:underline;">Open your invitation here</a>, or copy this link into your browser:</p>
<p style="margin:8px 0 0;font-size:11px;line-height:1.5;word-break:break-all;overflow-wrap:anywhere;"><a href="${safe.url}" style="color:#52615b;">${safe.url}</a></p>
</td></tr>
<tr><td style="padding:24px 28px;background:#071411;"><p style="margin:0 0 10px;color:#ffffff;font-size:15px;font-weight:bold;">Safe space. Smart storage. STOR24.</p><p style="margin:0;color:#bdc9c3;font-size:12px;line-height:1.6;">This invitation is just for you. Please don’t forward it.<br>Wasn’t expecting it? You can safely ignore this email.</p></td></tr>
</table></td></tr></table></body></html>`,
  };
}

import { escapeEmailHtml } from "./email";

type InvitationEmailInput = { name: string; invitedByName: string; roleName: string; inviteUrl: string; expiresAt: Date };

export function invitationEmail(input: InvitationEmailInput) {
  const url = new URL(input.inviteUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid invitation URL");
  const expiry = new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(input.expiresAt);
  const safe = Object.fromEntries(Object.entries({ name: input.name, inviter: input.invitedByName, role: input.roleName, url: url.href, expiry, logo: `${url.origin}/brand/stor24-logo-official-email-20260909.png` }).map(([key, value]) => [key, escapeEmailHtml(value)]));
  return {
    subject: "You're invited to STOR24 - activate your account",
    text: `Hi ${input.name},\n\n${input.invitedByName} has invited you to join STOR24 as ${input.roleName}.\n\nTo activate your account:\n1. Open your personal setup link: ${url.href}\n2. Create and confirm your password. Use 12-128 characters with uppercase and lowercase letters, a number and a symbol.\n3. Click "Accept invitation" on the STOR24 page to activate your account.\n4. When you see "Account activated", click "Open Stor24 CRM" to get started.\n\nOpening the email link alone does not activate your account. You must finish the password setup and accept the invitation on the STOR24 page.\n\nThis personal invitation expires on ${expiry} (South African time). If the link has expired or does not work, contact ${input.invitedByName} to check your invitation and arrange a new one if needed. Please do not forward this email. If you were not expecting this invitation, you can ignore it.\n\nSTOR24 - Space for life in motion.`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your STOR24 invitation</title></head>
<body style="margin:0;padding:0;background-color:#f5f3ea;font-family:Arial,Helvetica,sans-serif;color:#071411;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Create your password, accept your invitation and open STOR24 CRM.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f3ea"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="max-width:600px;border:1px solid #deded6;">
<tr><td bgcolor="#ff5a0a" height="6" style="font-size:0;line-height:6px;">&nbsp;</td></tr>
<tr><td style="padding:28px 24px 24px;"><img src="${safe.logo}" alt="STOR24" width="180" style="display:block;width:180px;max-width:100%;height:auto;border:0;"></td></tr>
<tr><td style="padding:0 24px 24px;font-family:Arial,Helvetica,sans-serif;color:#071411;font-size:16px;line-height:24px;">
<h1 style="margin:0 0 20px;font-size:28px;line-height:34px;font-weight:700;">Activate your STOR24 account</h1>
<p style="margin:0 0 12px;">Hi ${safe.name},</p>
<p style="margin:0 0 12px;">${safe.inviter} has invited you to join STOR24.</p>
<p style="margin:0 0 20px;"><strong>Your role:</strong> ${safe.role}</p>
<p style="margin:0 0 20px;">Use your personal link below to open the account setup page.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#ff5a0a" style="border:1px solid #ff5a0a;">
<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safe.url}" style="height:48px;v-text-anchor:middle;width:224px;" stroke="f" fillcolor="#ff5a0a"><w:anchorlock/><center style="color:#071411;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Set up my account</center></v:rect><![endif]-->
<!--[if !mso]><!--><a href="${safe.url}" style="display:inline-block;padding:12px 24px;color:#071411;font-size:16px;line-height:24px;font-weight:700;text-decoration:none;text-align:center;">Set up my account</a><!--<![endif]-->
</td></tr></table>
</td></tr>
<tr><td bgcolor="#f8f8f4" style="padding:24px;font-family:Arial,Helvetica,sans-serif;color:#071411;font-size:15px;line-height:23px;">
<h2 style="margin:0 0 16px;font-size:19px;line-height:26px;">How to activate your account</h2>
<ol style="margin:0;padding:0 0 0 24px;">
<li style="padding:0 0 12px;">Click <strong>Set up my account</strong> in this email.</li>
<li style="padding:0 0 12px;"><strong>Create and confirm your password.</strong> Use 12&ndash;128 characters with uppercase and lowercase letters, a number and a symbol.</li>
<li style="padding:0 0 12px;">Click <strong>Accept invitation</strong> on the STOR24 page to activate your account.</li>
<li style="padding:0;">When you see <strong>Account activated</strong>, click <strong>Open Stor24 CRM</strong> to get started.</li>
</ol>
<p style="margin:20px 0 0;"><strong>Opening the email link alone does not activate your account.</strong> Finish the password setup and accept the invitation on the STOR24 page.</p>
</td></tr>
<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;color:#4d5b55;font-size:13px;line-height:20px;">
<p style="margin:0 0 16px;"><strong>Invitation expires:</strong> ${safe.expiry} (South African time). This link is personal to you. Please do not forward this email.</p>
<p style="margin:0 0 8px;">Button not opening? Copy and paste this link into your browser:</p>
<p style="margin:0 0 16px;word-break:break-all;overflow-wrap:anywhere;"><a href="${safe.url}" style="color:#315847;text-decoration:underline;word-break:break-all;">${safe.url}</a></p>
<p style="margin:0 0 16px;">If the link has expired or does not work, contact ${safe.inviter} to check your invitation and arrange a new one if needed.</p>
<p style="margin:0;">Not expecting this invitation? You can safely ignore this email.</p>
</td></tr>
<tr><td bgcolor="#071411" style="padding:18px 24px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:12px;line-height:18px;"><strong>STOR24</strong> &middot; Space for life in motion.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`,
  };
}

import { escapeEmailHtml } from "./email";

type InvitationEmailInput = { name: string; invitedByName: string; roleName: string; inviteUrl: string; expiresAt: Date };

export function invitationEmail(input: InvitationEmailInput) {
  const url = new URL(input.inviteUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid invitation URL");
  const expiry = new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" }).format(input.expiresAt);
  const safe = Object.fromEntries(Object.entries({ name: input.name, inviter: input.invitedByName, role: input.roleName, url: url.href, expiry, logo: `${url.origin}/brand/stor24-logo-official-email-20260909.png` }).map(([key, value]) => [key, escapeEmailHtml(value)]));
  return {
    subject: "Your space on the STOR24 team is ready",
    text: `Hi ${input.name},\n\n${input.invitedByName} has invited you to join the STOR24 workspace as ${input.roleName}.\n\nA little less admin. More room to get things done.\n\nAccept your invitation and set up your account: ${url.href}\n\nThis personal invitation expires on ${expiry} (South African time). Please do not forward it. If you were not expecting this invitation, you can ignore this email.\n\nSTOR24 - Space for life in motion.`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your STOR24 invitation</title></head>
<body style="margin:0;background:#f5f3ea;padding:30px 12px;font-family:Arial,sans-serif;color:#071411;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your invitation to the STOR24 workspace is here. Let's get you set up.</div>
<div style="max-width:640px;margin:auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 18px 55px rgba(7,20,17,.14);">
<div style="height:9px;background:#ff5a0a;"></div>
<div style="padding:27px 34px 20px;"><img src="${safe.logo}" alt="STOR24" width="210" style="display:block;width:210px;max-width:70%;height:auto;border:0;"></div>
<div style="margin:0 18px;padding:34px 28px;border-radius:20px;background:#071411;color:#fff;">
<p style="margin:0 0 14px;color:#ff8a50;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;">One quick setup. Then you're good to go.</p>
<h1 style="margin:0 0 18px;font-size:34px;line-height:1.05;letter-spacing:-1px;">Your place on the team.<br>Let's make it official.</h1>
<p style="margin:0;color:#c7d2ce;font-size:16px;line-height:1.6;">Hi ${safe.name}, ${safe.inviter} has invited you to join the STOR24 workspace.</p>
<p style="margin:27px 0 8px;"><a href="${safe.url}" style="display:inline-block;background:#ff5a0a;color:#fff;padding:15px 25px;text-decoration:none;border-radius:999px;font-weight:800;">Accept invitation&nbsp; &rarr;</a></p>
</div>
<div style="padding:30px 34px;">
<p style="margin:0 0 18px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#d94c00;">What happens next?</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="44" valign="top"><div style="width:34px;height:34px;line-height:34px;text-align:center;border-radius:50%;background:#ff5a0a;color:#fff;font-weight:800;">1</div></td><td style="padding:0 0 18px;"><strong>Set up your account</strong><br><span style="color:#61706a;font-size:13px;line-height:1.5;">Accept your invitation and choose your password.</span></td></tr><tr><td width="44" valign="top"><div style="width:34px;height:34px;line-height:34px;text-align:center;border-radius:50%;background:#071411;color:#fff;font-weight:800;">2</div></td><td><strong>Make yourself at home</strong><br><span style="color:#61706a;font-size:13px;line-height:1.5;">Your role: ${safe.role}. A little less admin. More room to get things done.</span></td></tr></table>
<div style="margin-top:25px;padding:16px 18px;border-radius:14px;background:#fff4ed;color:#78310e;font-size:12px;line-height:1.55;"><strong>Keep it private.</strong> This invitation is unique to you, so please don't forward it. It expires on ${safe.expiry} (South African time).</div>
<p style="margin:20px 0 6px;color:#61706a;font-size:12px;line-height:1.55;">Button not opening? Copy this link into your browser:</p>
<p style="margin:0;font-size:11px;line-height:1.5;word-break:break-all;overflow-wrap:anywhere;"><a href="${safe.url}" style="color:#61706a;">${safe.url}</a></p>
<p style="margin:16px 0 0;color:#61706a;font-size:12px;line-height:1.55;">Not expecting this invitation? You can safely ignore this email.</p>
</div>
<div style="padding:20px 34px;background:#071411;color:#aebdb7;font-size:11px;"><strong style="color:#fff;">STOR24</strong> &middot; Space for life in motion.</div>
</div></body></html>`,
  };
}

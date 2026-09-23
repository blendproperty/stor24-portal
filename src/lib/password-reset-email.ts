import { escapeEmailHtml } from "./email";

export function passwordResetEmail(input: { name: string; resetUrl: string }) {
  const url = new URL(input.resetUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid reset URL");
  const name = escapeEmailHtml(input.name.trim().split(/\s+/)[0] || "there");
  const link = escapeEmailHtml(url.href);
  const origin = escapeEmailHtml(url.origin);
  return {
    subject: "Reset your STOR24 password",
    text: `Hi ${input.name.trim().split(/\s+/)[0] || "there"},\n\nLet's get you back in.\n\nWe received a request to reset your STOR24 workspace password. Choose a new password using this secure link:\n${url.href}\n\nThis link expires in 30 minutes and can only be used once.\n\nDidn't request this? You can ignore this email. Your password will stay the same. Keep this link private - our team will never ask you to share it.\n\nSTOR24 - Space for life in motion.`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset your STOR24 password</title>
<style>@font-face{font-family:Satoshi;src:url('${origin}/brand/Satoshi-Handover-400.woff2') format('woff2');font-weight:400}@font-face{font-family:Satoshi;src:url('${origin}/brand/Satoshi-Handover-700.woff2') format('woff2');font-weight:700}@media(max-width:480px){.email-padding{padding:24px!important}.email-title{font-size:30px!important}}</style></head>
<body style="margin:0;padding:0;background:#f5f3ea;font-family:Satoshi,Arial,Helvetica,sans-serif;color:#071411;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">A fresh password. Back to your day. Your secure link is valid for 30 minutes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f3ea;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dfe3df;border-radius:20px;overflow:hidden;">
<tr><td style="height:6px;background:#ff5a0a;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="email-padding" style="padding:30px 36px;"><img src="${origin}/brand/stor24-logo-official-email-20260909.png" width="190" alt="STOR24" style="display:block;width:190px;max-width:100%;height:auto;border:0;"></td></tr>
<tr><td class="email-padding" style="padding:32px 36px;background:#071411;color:#ffffff;">
<p style="margin:0 0 14px;color:#ff905a;font-size:11px;font-weight:700;letter-spacing:2px;">YOUR STOR24 WORKSPACE</p>
<h1 class="email-title" style="margin:0;font-size:38px;line-height:1.15;font-weight:700;letter-spacing:-1px;">Let&rsquo;s get you<br>back in.</h1>
<p style="margin:18px 0 0;color:#d4ded9;font-size:16px;line-height:1.6;">A fresh password. Back to your day.</p></td></tr>
<tr><td class="email-padding" style="padding:32px 36px;">
<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi ${name},</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#52615b;">We received a request to reset your STOR24 workspace password. Choose a new one and make yourself at home again.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#ff5a0a" style="border-radius:8px;background:#ff5a0a;text-align:center;"><a href="${link}" style="display:inline-block;padding:16px 28px;border:1px solid #ff5a0a;border-radius:8px;color:#071411;font-size:16px;font-weight:700;text-decoration:none;mso-padding-alt:0;">Reset my password &rarr;</a></td></tr></table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#52615b;">Your secure link expires in <strong>30 minutes</strong> and can only be used once.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;"><tr><td style="padding:18px;background:#f5f3ea;border-radius:10px;font-size:13px;line-height:1.6;color:#52615b;"><strong style="color:#071411;">Didn&rsquo;t request this?</strong><br>You can ignore this email. Your password will stay the same. Keep this link private &mdash; our team will never ask you to share it.</td></tr></table>
<p style="margin:24px 0 6px;font-size:12px;line-height:1.6;color:#52615b;">Button not opening? Copy this link into your browser:</p>
<p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;overflow-wrap:anywhere;"><a href="${link}" style="color:#52615b;word-break:break-all;">${link}</a></p>
</td></tr><tr><td class="email-padding" style="padding:22px 36px;background:#071411;color:#c7d2ce;font-size:12px;line-height:1.6;"><strong style="color:#ffffff;">STOR24</strong><br>Space for life in motion.</td></tr>
</table></td></tr></table></body></html>`,
  };
}

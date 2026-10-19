# Hostinger SMTP rollout — bookings@stor24.co.za

The adapter is opt-in (`EMAIL_PROVIDER=hostinger`). Installing/deploying it does not switch sending. It uses the existing purchased mailbox at smtp.hostinger.com:465, verified TLS1.2+, fixed login/envelope/From bookings@stor24.co.za, and server-only HOSTINGER_SMTP_PASSWORD. EMAIL_FROM for other providers is unchanged. Never put the password in chat, source control, GitHub output or NEXT_PUBLIC_ variables. Do not reset the mailbox credential merely to test this adapter.

## Test before switch

1. Confirm existing mailbox credential through an authorised secure server-secret setup. Store HOSTINGER_SMTP_PASSWORD server-side without changing EMAIL_PROVIDER. Never display it. Existing runtime has no SMTP secret as checked19October2026.
2. Use Nodemailer transport.verify() against the fixed endpoint with certificate validation enabled. This proves TLS/authentication, not delivery, and sends no email. Current production-host unauthenticated TLS1.3 connection already passes; authentication remains untested.
3. In an isolated test process, select hostinger only for that process, send one clearly labelled synthetic message to Brett's authorised business mailbox through the normal DLP guard, and verify receipt and SPF/DKIM headers. Use no real OTP/customer/financial data. Record provider acceptance separately from recipient receipt. Do not automatically retry uncertain SMTP outcomes.
4. Only after delivery passes, change the production provider under the authorised cutover, recreate the app with the same released image and verify normal fresh booking email-code flow. Do not reuse expired booking codes or bypass CAPTCHA/approval controls. Independently approved customer/staff notices retain their existing review and activation gates; changed sender/credential invalidates staff-event sender fingerprints.

## Evidence and rollback

Keep current provider/env backup private. No SendGrid plan, purchase or billing changes are part of this rollout. Rollback restores EMAIL_PROVIDER and original EMAIL_FROM; preserve all communication and audit evidence. SendGrid's prior zero-allowance failure is not a reliable rollback delivery service. Do not automatically fall back after uncertain sends, or replay failed customer messages in bulk. SMTP acceptance must never manufacture delivered/read timestamps. Existing Hostinger package shows3000sends/rolling24hours, with shared mailbox traffic and provider burst controls to be checked before high volume. Production monitoring's separate SendGrid-only alert script is not migrated by this adapter.

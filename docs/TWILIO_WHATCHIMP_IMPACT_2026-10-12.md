# STOR24 Twilio / WhatChimp impact audit — 12 October 2026

Recommendation: retain the existing STOR24 Twilio sender and introduce a separate, dedicated WhatChimp bot number. Moving the existing WhatsApp sender is an application-provider migration, not a dashboard-only change. No migration or bot connection has been performed.

## Evidence checked

- Canonical CRM `blendproperty/stor24-portal`, main and deployed checkout `574be386e5d882ef399180f4c92c85b8f7af7eea`; running `stor24-crm:574be386`, healthy. Canonical website `blendproperty/stor24`, master `fcd66758c9cc66038cf822f63122621d9bb9e981` inspected for booking proxy/UI dependencies; website runtime was not reverified in this audit.
- Read-only Twilio IncomingPhoneNumbers and WhatsApp Senders v2 API queries using the running CRM's credentials. STOR24 sender ending 1324 is ONLINE, profile Stor24. SMS and WhatsApp use that same Twilio-owned number; SMS and voice capabilities are present. Its SMS webhook/application and voice webhook/application are unset. WhatsApp inbound callback and sender-level status callback are blank. Outgoing application sends independently supply the CRM status callback.
- The latest 100 account-wide provider messages span 22 September–12 October 2026: 35 outbound WhatsApp messages marked read, 62 outbound SMS messages delivered, three inbound SMS messages received. This is a bounded account sample, not a full-history or per-flow delivery guarantee. Message bodies, OTP values, customer details and credentials were not reported.
- Read-only database aggregates: 80 initial booking verification-send events and two resend events, all channel WHATSAPP, most recent initial send 12 October at 11:50:51 SAST. These are historical provider-acceptance audit events, not proof that every OTP was received or used. Communication logs include 69 successful WhatsApp reservation confirmations, five successful viewing notifications and six successful PAYMENT_RECEIVED records. Payment follow-up inspected is UAT simulator code; these six records do not prove real payment settlement.
- Runtime public reservation verification is configured. General WhatsApp server gate is true; the organisation automation switch is false. Booking OTP delivery does not consult that switch. Verified public reservation/viewing notifications, explicit staff sends and UAT payment follow-up have explicit allowed exceptions. Therefore the general switch being off does not mean WhatsApp is unused.

## Effect of migrating only WhatsApp

| Flow | Current dependency | Effect without integration changes |
|---|---|---|
| Booking mobile OTP and resend | Twilio approved verification template first; SMS fallback if provider call fails | WhatsApp verification breaks. SMS fallback may work if retained, but provider acceptance is not final delivery; it is not a safe migration plan. |
| SMS received on the Twilio number, including external verification codes | Telephone number retained with Twilio | Expected to remain available if number/account/SMS settings are retained. Existing SMS callback/application is blank; no SMS forwarding flow was found on this number. No new OTP was requested or received for this audit. |
| SMS sent to customers | Twilio Messages API and SMS sender | Expected unaffected by WhatsApp-only migration; changing/porting/releasing number or credentials would affect it. |
| Email OTP and email messages | Separate email provider | No direct Twilio WhatsApp dependency. |
| CRM staff authenticator MFA/recovery codes | Local TOTP and encrypted secrets | No direct Twilio WhatsApp dependency. Other admin/provider login OTP mechanisms were not comprehensively audited. |
| Reservation/viewing WhatsApp messages and explicit staff messages | Twilio Content SIDs and Messages API | Need replacement provider calls, template mappings and logging. |
| UAT payment WhatsApp follow-up | Twilio PAYMENT_RECEIVED template; outcome affects follow-up completion | Must be migrated and retested; this does not establish production payment acceptance. |
| Other lifecycle templates | Eight configured lifecycle template mappings, general switch off | Preserve gates and prepare replacement mappings before future enablement. Configuration does not prove each flow is operational/UAT accepted. |
| Delivery tracking/retries | Twilio signatures, provider references, status callback and communication logs | WhatChimp events/references need an adapter; Twilio handler cannot simply process WhatChimp payloads. |
| Incoming WhatsApp/STOP handling | CRM signed inbound handler exists; sender callback blank | Currently unwired at sender level. Any bot/handoff/opt-out connection needs explicit integration and tests. |
| Operational monitoring alerts | GitHub workflow uses separate Twilio secrets/variables | Code dependency confirmed; workflow's actual sender/template configuration not read back. Must check before same-number migration. App environment absence does not prove alert channel is disabled. |

## Options

1. Separate WhatChimp number: recommended for preserving current flows. Bot can answer approved FAQs, capture enquiries and link to the existing booking site. Any CRM lead API integration requires scoped development/testing. Distinguish bot number from existing verification/notification number for customers. Check ownership, eligibility, current use and Meta onboarding before choosing a number; no spare existing number was approved for reuse.
2. Keep one number and keep Twilio: develop a bot using Twilio inbound webhooks/Studio or an integration verified to support Twilio WhatsApp. Preserve delivery tracking, consent and human handoff. WhatChimp's documented Twilio connector is SMS; it is not evidence of support for the existing Twilio WhatsApp sender.
3. Keep one number and use WhatChimp: first implement and test a WhatChimp provider adapter for verification/templates, status tracking, idempotency, retries, consent/opt-out and staff handling. Test website reservation/resend and UAT payment follow-up plus monitoring sender configuration. Schedule a separately authorised cutover only after provider/template and controlled handset acceptance. Retain Twilio number rental/SMS/voice when moving WhatsApp; do not port/release it.

WhatChimp Business App coexistence is for the mobile WhatsApp Business App plus WhatChimp API; it is not evidence of simultaneous Twilio and WhatChimp API ownership of this sender.

## Sources

- CRM: `src/lib/public-booking-service.ts`, `src/lib/public-booking-contract.ts`, `src/lib/integrations/twilio-provider.ts`, `src/lib/whatsapp.ts`, `src/lib/integrations/whatsapp-automation.ts`, `src/lib/notifications.ts`, `src/lib/public-payment-follow-up.ts`, `src/lib/mfa.ts`, Twilio inbound/status routes, communications routes and `.github/workflows/monitor-production.yml`.
- Website: `app/api/booking/reservations/verify/route.ts`, `app/api/booking/reservations/resend/route.ts`, `app/components/booking/UnitFinder.tsx`.
- [Twilio sender API](https://www.twilio.com/docs/whatsapp/api/senders), [WhatChimp Twilio SMS integration](https://app.whatchimp.com/docs/management/integration), [WhatChimp provider migration](https://whatchimp.com/docs/how-to-migrate-your-whatsapp-business-api-from-your-current-bsp-to-whatchimp/), [WhatChimp Business App coexistence](https://help.whatchimp.com/docs/setup-and-configuration/whatsapp-coexistence).

## Evidence limits and remaining gates

This is a completed read-only impact assessment, not a bot implementation, migration, message-send test or business launch. No new customer/provider/configuration records, codes, templates or messages were created. Handset receipt/resend/fallback, bot routing, staff handoff, provider eligibility, template approval, opt-out, rollback, operational alerts and any cross-provider cutover remain unverified. Existing finance/legal/provider/data/device/UAT/training/approval gates remain open.

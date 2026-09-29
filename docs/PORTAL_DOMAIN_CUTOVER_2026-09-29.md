# Portal domain cutover - 29 September 2026

The existing CRM and customer portal now use `https://portal.stor24.co.za` on the existing VPS and database. Staff sign in at `/login`; customers use `/my`. This is a domain migration, not acceptance of the remaining business workflows.

## Configuration

- Hostinger DNS: `portal` A record `93.127.186.194`, TTL 60. Authoritative DNS, Google and Cloudflare returned the new record. Existing mail records remain unchanged.
- `/opt/stor24-crm/.env`: `APP_URL=https://portal.stor24.co.za`, `APP_HOST=portal.stor24.co.za`, `TWILIO_LEGACY_WEBHOOK_ORIGIN=https://stor24-site.srv938083.hstgr.cloud`.
- Tracked `compose.prod.yml` routes the canonical host to the existing application. Legacy non-API GET/HEAD requests redirect permanently with path and query preserved. Legacy APIs and POST callbacks remain served directly.
- Twilio signature validation accepts only the configured canonical and optional legacy origins; forwarded-host headers cannot expand this list. Keep the legacy origin until provider callback URLs and in-flight traffic have been independently reconciled.
- Public website `/opt/stor4/.env`: `STOR24_PORTAL_URL=https://portal.stor24.co.za`. Its existing Compose references this variable. Desktop/mobile portal links and booking/merchandise handoffs use the canonical portal.
- Existing sessions are hostname-scoped. Users sign in again; no cookies or authentication material are copied across domains. Existing staff credentials and customer email-code behavior are unchanged.

## Release evidence

- CRM source `5f597570ae225ff525c683ee354fce6a4461a3ea`, PR355 merged by fast-forward to canonical `blendproperty/stor24-portal` main. All nine PR checks passed, including CI 36573494442, PostgreSQL transaction checks 36573494332, security 36573494256 and CodeQL 36573490800. Deployment 36574542044 succeeded with image `stor24-crm:5f59757`.
- Public website source `44aa1911f75ad0aeae6cb1430c4de6765128eaf0`, PR85 merged as `bfc5820e6b125dc1217404c618f59ecdded01bde` to canonical `blendproperty/stor24` master. Focused five unit cases and production build passed locally; browser/validation 36573497537 and security 36573497637 passed. Master security 36575020249 passed. Deployment evidence is recorded in both repositories' PROJECT_CONTEXT.md.
- No schema, customer-data, payment-mode or provider-credential change. Existing dirty primary checkouts were preserved; isolated clones were used.

## Live checks

At 13:25 UTC, strict HTTPS `/api/health` returned 200 with service/database `ok`; container was healthy. The Let's Encrypt certificate covers `portal.stor24.co.za` and expires 28 December 2026. Staff `/login` and customer `/my` rendered in a real browser without security exceptions.

Legacy `/my?booking=ST24-DOMAIN-CHECK` reached the same path/query on the canonical domain. Legacy `/api/health` remained directly available. A cookie-free canonical-origin order request returned 401 before checkout, while a foreign origin returned 403. Synthetic, correctly signed empty Twilio status callbacks on both domains returned the expected 422 missing-MessageSid validation; unsigned requests returned 403. The payload deliberately stopped before any database lookup or mutation. These checks prove routing and signature acceptance, not actual provider delivery or customer UAT.

## Rollback

Root-only backup directory `/root/stor24-portal-domain-backup-20260929` contains the original CRM environment and Compose, immediate pre-cutover CRM environment, original public Compose and `web.env.original`. These private files must never be committed or published.

If rollback is required, first compare current files against the backup to preserve later unrelated changes. Restore the three CRM URL settings and public `STOR24_PORTAL_URL`, restore the prior tracked Compose/application release `38c31e048cb5a06424ec9ab3147b7a187727d2bf`, then recreate only the affected applications with the existing deployment process and verify health. Restore public source to the pre-PR85 release if reversing its links. No database restore is part of this domain rollback. Keep the new DNS/HTTPS endpoint available until active browser sessions and links are reconciled; removing DNS immediately would strand new links.

## Remaining gates

Authenticated staff/customer UAT, actual provider callbacks and inbox delivery, Netcash/live-money readiness, legal/privacy, physical access, finance/MRI, data, training and business approvals remain open. No real booking, payment, message or identity transaction was submitted during these checks. Domain cutover does not mark tracker acceptance or operational launch readiness complete.

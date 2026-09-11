# Tenant merchandise checkout — draft release gates

11 September 2026. PR100 is not a complete or enabled purchasing journey.

## Stock expiry worker

The authenticated POST `/api/v1/operations/merchandise-orders/expire` processes at most 100 expired unpaid orders per call. Configure a dedicated high-entropy credential outside source control; only its SHA-256 hex digest belongs in `MERCHANDISE_CRON_SECRET_SHA256`. The scheduler presents the raw credential in `x-cron-key`. Do not reuse a tenant session, staff password or billing worker credential.

Before checkout enablement, an operator must install and verify a recurring worker, monitor non-2xx responses, and ensure the backlog drains. The route is implemented, but no production credential or schedule has been installed. A stock inconsistency fails the current batch and needs investigation; it must not be cleared by blindly adjusting inventory. Order locks make retries safe against payment/cancellation, but transactional integration evidence remains outstanding.

Disabling `TENANT_MERCHANDISE_CHECKOUT_ENABLED` must stop new checkouts without disabling this expiry worker or verified payment callbacks: existing holds and late payments still need resolution.

## Remaining promotion gates

Return-route inspection: the public repository currently routes both Netcash accept and decline to `/pay/netcash/return`, and decline invokes the booking cancellation endpoint. Merchandise forms now include `Extra2=merchandise` as a navigation hint only. Public routing must branch to the fixed CRM `/my/orders/<orderId>` destination and skip booking cancellation for this flow. Neither the marker nor browser return is payment/ownership evidence: CRM session-scoped order lookup and verified webhook remain authoritative. This cross-repository change is not implemented yet; enablement stays blocked pending it.

- Link a unique payment to its order before returning any Netcash form.
- Complete tenant checkout, authenticated return/cancel/status handling and staff fulfilment UI.
- Mount the single purchases/catalogue/basket journey; remove duplicate request sections without mislabelling old requests as purchases.
- Confirm provider return routing, actual merchandise amounts and VAT treatment; do not reuse the controlled R10 booking amount.
- Required CI and transaction/concurrency/ownership checks; no local tests requested by the user.
- Keep live enablement off until configuration and end-to-end UAT are verified. No real orders or payments are authorised by this draft.

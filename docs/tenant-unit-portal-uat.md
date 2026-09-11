# My STOR24 unit-first portal — acceptance checks

## Customer checks

1. Sign in at `/my?organisation=stor24` using your own verified email and code.
2. Choose a unit under **My units**. Confirm its store and number. Booking status is not confirmation of active access.
3. View a statement, then switch units. The previous statement must disappear; a newly opened statement must belong to the newly selected account.
4. Under **Documents for this unit**, check the agreement reference and receipt. Signed bookings without converted tenancies are included. Public test-payment accounts are linked only by the exact reservation/customer relationship used by the public payment service.
5. Inspect packing supplies and their quantities. A reserved package is not proof of payment or fulfilment.
6. Expand **Shop packing supplies**. Search for boxes/tape, enter quantities, and check the selection total. Changing units starts a separate selection.
7. If deliberately testing a real store request, click **Request these supplies**. This creates a customer-visible request and an operational CRM task. It does not take payment, add a balance, reserve stock or fulfil an order. Do not submit disposable requests without identifying them as test work with the store.
8. Refresh: the request and quoted items/total must remain under the same unit. Other units must not display it.
9. **Other account records** retains historical/unassigned accounts without inventing unit links. Deep links to these accounts remain valid.

## Store checks

1. Open Operations. Find **Packing supplies request · Unit …**.
2. Expand **View request details**. Confirm quantities, SKUs, quoted prices and customer link.
3. Confirm stock, payment and collection with the customer through the authorised operating process. Completing the CRM task is only a follow-up status, not a payment or stock movement.

## Still required before claiming full purchasing complete

- Standalone merchandise order/payment/fulfilment flow and approved provider charging configuration; the controlled R10 public booking test is not merchandise checkout.
- Authorised authenticated cross-customer/organisation access checks, actual request/retry workflow, mobile visual checks and user acceptance. CI is not proof of these live behaviours.
- Historical physical-unit attribution where an account has been transferred: account-level financial records are not fabricated into unit-specific allocations.
- No customer sessions are created or bypassed for verification, and no payment/stock mutations are made by read-only release checks.

# Recover retained developer payment classifications

14 October 2026. Use this maintenance command when an older developer payment is retained in Stor24 but its provider-verified card/EFT method has not yet been saved. It does not repair Netcash merchant-portal account/date filters or perform a new checkout.

Prepare a private JSON manifest containing `organisationId`, `facilityId`, a non-secret `maintenanceReference`, and one to twenty unique `paymentIds`. Every target must be a retained sandbox Netcash Pay Now/card-subscription payment, belong to that exact organisation/store and retain its original reference. Do not include credentials, bank/card data or provider traces.

Run with the matching validated source, generated Prisma client and configured server runtime:

```sh
npx --no-install tsx scripts/recover-netcash-test-evidence.ts /private/manifest.json
```

The default is a database-source preview: no provider requests and no metadata writes. It validates the entire named target set. To apply, set `NETCASH_EVIDENCE_MAINTENANCE_ENABLED=true` only in the maintenance process and add `--apply`; do not enable a permanent production flag. This reads each original transaction from Netcash's status service, then uses the same exact reference/trace/amount/ZAR/merchant/environment/configuration checks as staff classification refresh.

Only signed method/acceptance observation metadata and an atomic audit are written. Payments, account balances, ledger entries, batches, emails and access remain unchanged. The audit records `SYSTEM_MAINTENANCE`, a null human actor and the maintenance reference. It does not attribute a server job to a logged-in staff member. Ordinary staff refresh retains its authenticated actor and existing permission/scope requirements. No maintenance web endpoint or credential is added.

The result prints aggregate method counts and progress, without payment/customer identifiers, provider references, traces, tokens or response bodies. Any source/provider mismatch stops the run; a partial result identifies the count completed, rather than claiming all targets were recovered. Repeating classification reads never retries a financial transaction. Keep this manifest private and check the persisted evidence/audit through a read-only aggregate before recording live recovery.

Evidence recovery is separate from authenticated staff report/filter UAT, live payment/settlement acceptance and company/provider approval. Wider Netcash payment-request, DebiCheck, refund and accounting workflows remain tracked in `NETCASH_FULL_PAYMENT_SCOPE_2026-10-14.md` and `PROJECT_CONTEXT.md`.

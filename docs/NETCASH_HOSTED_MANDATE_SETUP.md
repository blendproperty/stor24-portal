# Hosted Netcash eMandate setup — 10 September 2026

## Status and scope

Implemented for controlled individual-customer test-account UAT, disabled by default.
This is a signed **standard EFT eMandate**, not DebiCheck bank authentication.
No debit submission, masterfile activation, ledger posting, tenancy activation or
access grant is connected to it. Pay Now's existing test switch is unchanged.

## Verified provider contracts

- https://api.netcash.co.za/inbound-payments/emandate/emandate-synchronous/
- https://api.netcash.co.za/inbound-payments/emandate/emandate-download-mandate-data/
- https://api.netcash.co.za/inbound-payments/emandate/emandate-download-mandate-data-pdf/
- Live WSDL and xsd0: https://ws.netcash.co.za/NIWS/NIWS_NIF.svc?wsdl

SOAP 1.1 NIWS_NIF uses `http://tempuri.org/INIWS_NIF/AddMandate` and
ordered scalar fields, not the legacy guessed REST client. It uses the encrypted
Debit Order service key. `AddToMasterFile`, `MandateActive`, `IncludeDebiCheck`,
`AllowVariableDebitAmounts` and `RequestAVS` are false. Banking fields are omitted
so the customer enters them directly on Netcash and signs with their own OTP.

The browser form return is untrusted. Only its random correlation and account
reference are used to route back. No posted success flag, bank data or PDF URL is
persisted. `RequestMandateData` / `RetrieveMandateData` independently bind the
provider's accepted status 6 to the immutable agreement/reference, amount,
monthly frequency, day/month, notice, holiday, non-variable basis and correlation.
Unknown or mismatched states do not become signed. No automatic mandate retry
after creation uncertainty. A unique lease link prevents duplicate requests.

The separate PDF is requested by exact account reference, server-downloaded with
the service key hidden, validated as a PDF and hash-checked in durable storage.
It is linked via reservation to the customer; customer and scoped staff download
routes are supplied. Only explicitly allowed HTTPS provider hosts can receive the
download. Real redirect-host compatibility remains UAT, not assumed working.

## Required configuration — do not invent or auto-enable

1. Obtain the business-approved monthly debit days, cancellation-notice period,
   public-holiday handling and first-payment/deposit/package treatment. Current
   implementation supports fixed signed monthly rent only, with the first
   payment handled separately. If that is not the approved business model, extend
   the model before enabling it. The existing lease wording remains draft and
   legal approval is still required for real tenants.
2. Set Netcash's dedicated **synchronous eMandate** postback URL to:
   `https://stor24-site.srv938083.hstgr.cloud/api/webhooks/netcash/mandate`
   Do not overwrite Pay Now or normal debit-batch notification URLs.
3. In the CRM environment, set `NETCASH_MANDATE_POLICY` to a JSON object with
   `organisationId`, `approvedBy`, `noticeDays` (1–60), `holiday`
   (`PrecedingOrdinaryBusinessDay` or `VeryNextOrdinaryBusinessDay`), `allowedDays`
   (approved subset of 1–28), `recurringAmountBasis: "SIGNED_MONTHLY_RENT_ONLY"`,
   `firstPaymentHandling: "SEPARATE_APPROVED_PAYMENT"`, and
   `postbackConfigured: true`. No example commercial values are production defaults.
4. Only after checking the configuration and arranging one consenting test
   customer, set `NETCASH_MANDATE_SETUP_ENABLED=true`. The account must still be
   the configured test merchant (11 digits starting with 5). Live-account setup
   remains blocked. Do not change the Pay Now transaction switch.

Standard AddMandate accepts a commencement month/day, not a separately priced
first instalment/date/year. The current flow therefore requires the first date
to match the selected monthly day in the current calendar year, and only supports
days 1–28. Different first instalments, year rollover, month-end/day29–31,
business signatories and variable amounts require explicit extension and UAT.

## Required real UAT before any readiness claim

Use one valid, unexpired test booking. Save dates; explicitly prepare the mandate;
confirm the hosted amount and terms; the customer enters bank data and their OTP
and signs themselves. Confirm the browser returns to the original booking.
Use Check confirmation: report generation is asynchronous (30-second retry UI).
Confirm the independently verified status, separate PDF byte/hash storage,
customer/staff download and customer-linked follow-up task. Verify no financial
or access records were changed. Repeat controlled decline, expiry, uncertain
timeout, duplicate start/return, schedule mismatch and report/PDF outage cases.

Read-only live evidence this turn: configured connection HEALTHY/test, encrypted
Debit Order key present; RequestMandateData accepted the key and returned a
three-part numeric file token (the docs show five parts). Immediate retrieve
returned FILE NOT READY. No AddMandate, OTP, signature or collection was invoked.
This is NOT full provider/UAT proof.

## Outstanding operational work

- Agree and configure business policy and dedicated Netcash return URL.
- Run real AddMandate/signature/status/PDF and failure-path UAT.
- Add controlled staff recovery/reissue for ambiguous requests; do not manually
  clear the unique session and blindly retry.
- Extend differing first payment, month-end/year-rollover and business mandates
  only after approved requirements; enable DebiCheck separately if required.
- Collections, reconciliation, commercial VAT/deposit/prorata approval, move-in
  readiness, legal review and release sign-off remain separate open gates.

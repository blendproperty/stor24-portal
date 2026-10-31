# STOR24 launch attribution verification - 30 October 2026

Ads must remain paused until Brett gives separate launch approval.

## Implemented candidate

The website and operational CRM share an exact approved campaign/ad/card/keyword register. Consented first-touch campaign metadata survives public navigation, persists in the CRM attribution audit and appears in scoped lead details, the marketing channel report and payment-cohort campaign labels. Internal CRM campaign IDs and spend joins retain their existing meaning. Unknown/unapproved URL values remain unknown; UTMs are visitor-supplied claims, not proof of an authentic platform click.

Dedicated Meta dataset: `2256945718217336` (STOR24 Website), business `973585675506776`, ad account `1064679099720272`. The owner approved its creation and the Meta Business Tools Terms. Automatic advanced matching is off; the portfolio-wide Conversions API option was unchecked. All four published Facebook ads now select this dataset. API readback confirms each ad, ad set and campaign is PAUSED; provider review/processing does not enable delivery. Original Review and publish(3) campaign drafts are preserved. Three Google STOR24 campaigns are independently PAUSED.

Explicit Meta image transport sends only PageView and saved-enquiry Lead events, clean public page addresses, no HTTP referrer, a random browser cookie and a syntactically bounded Facebook click identifier when present. No external Meta script, automatic events, form/contact fields or customer matching upload. Consent edition v4 requires renewed permission. Meta cookies expire after 90 days and accessible cookies are removed on withdrawal. This is browser measurement; consent refusal, blocking and provider attribution/reporting delays are real limitations. No CAPI token is configured. The transport is derived from Meta's generated pixel image snippet and official SDK event transport; actual dataset event acceptance remains a production gate, not inferred from HTTP success.

Quote requests also forward the first proxy-provided visitor address through the authenticated CRM proxy, matching the micro-enquiry route. Previously quote saves shared the website server's CRM IP limit, which can suppress CRM recording after 20 submissions/hour. Security rate limits remain enabled; raw addresses are used only at this internal security boundary and stored as the existing privacy hash.

## Evidence

- Five actual browser forms -> real website handlers/proxy -> authenticated CRM route -> isolated PostgreSQL -> actual scoped staff marketing report. Four campaign/card/keyword snapshots retained, one consent-off unknown. Google and Meta each dispatch one saved event per consented successful save. Store isolation and failed-CRM exclusion pass. The fixture asserts the same unique documentation-range visitor address arrives through both enquiry proxies, retaining real rate-limit enforcement and avoiding contamination from previous test runs.
- Booking producer integration checks retain attribution for STORAGE and MICRO_WAREHOUSE, both rental and viewing (four producers).
- Actual form saved/pending/error regressions: 12 intercepted fixtures, including quote1440/390/320. Meta Lead is absent for pending/error results.
- HTTPS browser checks verify consent-off, secure90-day cookies, retained click across navigation, clean page/referrer policy, revocation, private-route exclusion and absence of Meta SDK traffic.
- CRM Linux unit suite before the separate operational-forms merge: 1100 total,1099 pass,0 fail,1 existing optional skip. Correct typecheck uses Next route generation. Website production build and complete hosted checks passed at2c07c42 before the final proxy-address repair; new exact-head checks are mandatory.
- Desktop1440/mobile390/320 staff report checks pass without document overflow. No production lead, booking, payment or provider message was used in these fixtures.

## Repeat the integrated test

Use disposable PostgreSQL and Linux Node24.22.1, both checkouts and installed dependencies, generated Prisma client, the committed CRM migrations and Playwright Chromium. An empty database must be named `merchandise_ci` and reachable as `localhost`; the script rejects other database hosts/names and requires `MERCHANDISE_DB_TEST=isolated-ci`. Set `LAUNCH_WEBSITE_ROOT` to the companion website checkout. From the CRM checkout run:

```sh
MERCHANDISE_DB_TEST=isolated-ci LAUNCH_WEBSITE_ROOT=/path/to/stor24 npx tsx scripts/test-launch-attribution-e2e.ts
```

Use a synthetic DATABASE_URL supplied separately; never use production credentials. The script creates labelled synthetic records and removes its organisation/customer/lead fixtures. It does not weaken production CAPTCHA, rate limits or provider behaviour. CAPTCHA, n8n, Google and Meta transports are intercepted boundaries. Repeated earlier runs without unique visitor headers exhausted the isolated database's unknown-IP quota and correctly produced pending CRM delivery; the repaired test now verifies per-visitor proxy headers. Windows git archive may apply CRLF: use `git -c core.autocrlf=false archive HEAD` for a canonical Linux snapshot.

## Open release gates

Normal final checks, CRM-first merge/deployment, website deployment, exact image/source/health readback, real Meta PageView and Lead ingestion, GA ingestion and a controlled real-provider/CAPTCHA submission. Platform-paid click attribution cannot be proven with fabricated UTMs while ads are paused. Business/device UAT, all previous privacy/legal/provider/data/training/payment/access/recovery gates and separate launch/spend approval remain open. See each canonical PROJECT_CONTEXT.md for promotion receipts. No external project tracker is in scope.


## 31 October real saved-enquiry and cleanup receipt

Following direct owner approval, three genuine CAPTCHA-protected browser submissions saved in production on CRM448094d6 after its05:14:57Z container start: Facebook05:15:41Z, Google micro05:16:34Z, and Google storage-to-micro journey05:16:56Z. Exact source/campaign/ad/group-or-set/card/keyword and the complete4page journey passed read-only PostgreSQL assertions and are visible in normal staff UI. Google realtime records exactly3generate_lead key events. Enabled custom goal6459477840 selects only STOR24 action7847049246 for all3Google campaigns.

The exact3synthetic records were closed Lost at05:19:10Z through normal owner UI; source/audit history is retained and SQL readback confirms all3closures with one cancellation audit each. No reservation/lease/payment/unit hold, permanent deletion or real customer contact. Treat the3controlled Lead events/retained QA cohort as test baseline when reviewing campaign outcomes. Earlier CAPTCHA-pending receipts are superseded by this explicit approval and successful submission evidence.

Normal website17c1cec deployment41170369721 and CRM448094d6 deployment41171582853 are successful and owning image/source/health are independently verified. Meta PageViews are received; the saved-test Lead receipt is still awaiting provider processing and is not yet claimed. Normal evidence-PR promotion/default-branch context readback, genuine paid-click matching after separately approved ad activation, storage-booking OTP/provider and previous staff/device/privacy/legal/business acceptance gates remain distinct. Ads remain paused.

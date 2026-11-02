# STOR24 launch tracking verification - 31 October 2026

**Ads remain paused.** Website/CRM attribution and Google saved-lead receipt pass real production tests. Meta ordinary reporting independently records three browser Leads for the three original saved tests; a fourth real saved-enquiry diagnostic test was also independently processed. All four synthetic records are closed Lost. Actual paid-click matching and advertising activation remain separate owner approval gates.

## Current verification

| Layer | Evidence | Result |
| --- | --- | --- |
| Google Ads | Six ad URLs/suffixes; all three STOR24 campaigns select enabled saved-enquiry goal 6459477840/action 7847049246 | Configured; campaigns paused |
| Facebook/Instagram | Four published ads select STOR24 Website dataset 2256945718217336; campaign/content tags checked, including both micro-image link and CTA | Configured; ads/sets/campaign paused |
| Website to CRM | Three real Google-CAPTCHA submissions; exact PostgreSQL attribution assertions and normal staff views | Pass |
| Cross-page attribution | Google storage landing -> contact -> home -> micro enquiry; campaign/ad/group/keyword and four paths retained | Pass |
| Staff campaign report | Three approved campaign rows, each with one enquiry and the correct creative/ad/keyword | Pass |
| Google Analytics | Exactly three real generate_lead key events for the three successful saves | Pass |
| Meta website events | Ordinary WEB_ONLY reporting shows 3 Lead events in the 05:00Z hour, matching the original three saves; a fourth real save separately passes Test events | Ordinary and live diagnostic receipts pass |
| Test cleanup | Exact three synthetic enquiries closed Lost at 05:19:10Z, with original attribution/history and one cancellation audit each retained | Pass |

The four synthetic records are **QA baseline, not acquired customers**. The three original tagged campaign cases and their three observed Google key events are separate from the fourth Meta diagnostic test. The closed CRM records and provider events remain auditable. Exclude this cohort or account for the baseline when interpreting launch results.

## Actual production save evidence

All records belong to Store 1 - Midpoint and MICRO_WAREHOUSE. Reserved example.invalid emails, a dummy phone number and explicit synthetic/do-not-contact notes were used. No unit hold, reservation, lease, payment or real customer contact was created.

| Case | Lead ID | Retained attribution |
| --- | --- | --- |
| Facebook micro image,05:15:41Z | cmvvy6ve7000101qysi6cc6mi | facebook/paid_social; stor24_micro_warehousing_round2_20261015; campaign120253973217080268; ad120253973306780268; set120253973305590268; micro-image |
| Google micro,05:16:34Z | cmvvy8096000401qy4lsm2lnw | google/cpc; stor24_micro_warehouse; campaign24352709658; ad828126323236; group206836243411; micro warehousing midrand |
| Google storage-to-micro journey,05:16:56Z | cmvvy8hfc000701qyg2nsidj2 | google/cpc; stor24_midrand_search; campaign24315694704; ad826923892509; group201418428952; self storage midrand; original/storage/midpoint landing and all four public paths |

The owner approved these actual CAPTCHA submissions and test closure. Initial older-widget timeouts resolved after normal reload; verification stayed enabled and no fake token or production security bypass was used. All three saves happened after the final CRM448094d6 container started at 05:14:57.879515949Z.

The additional Meta diagnostic save is cmvvzc6as000301o1bfvqxtyy at 05:47:48.580Z, reserved stor24-launch-20261031-meta-retest@example.invalid. Meta Test events shows standard Lead / Processed / Browser / Manual setup, event ID 494617367-192556471-2850128950-577672526 at 07:47:48 SAST. Its clean Meta-launched page correctly retains facebook/social/referrer, with no advertising campaign claim. Actual CAPTCHA and normal saved acknowledgement were used. It is independently confirmed Lost with one cancellation audit. At 06:00:17Z, ordinary Meta WEB_ONLY reporting independently shows 3 Leads for the original three cases, closing their delayed reconciliation. The fourth diagnostic receipt remains separate from that ordinary total. Neither fabricated tags nor test receipts prove paid attribution.

## Release evidence

- Website tracking PR231 and dependency PR232 released as17c1cec807d3e4f840f2df5c0215739c01ad1556. [Exact-master security41170078770](https://github.com/blendproperty/stor24/actions/runs/41170078770) and [restricted deployment41170369721](https://github.com/blendproperty/stor24/actions/runs/41170369721) passed. Owning source, healthy image sha256:b3361f69f9dcc0e4026bf980100358d775365c904702273ecd1b3b544b18ff65, five TLS200 routes and17public bundles confirm the deployed tracking/consent/CSP changes.
- CRM attribution PR679/681 and dependency PR683 released as448094d6e11317ee8f97ec4d6a2885c1720eba8f. Exact-main CI41170520485, Security41170520433, Merchandise41170520428 and Restricted runtime41170520425 passed before [deployment41171582853](https://github.com/blendproperty/stor24-portal/actions/runs/41171582853). Owning source, healthy image sha256:e78da91ebf2c305253221297cd55cbdf53ccdfa05ee7216cb97990c0840e0b16 and actual portal.stor24.co.za/api/health200 were independently verified.
- Concurrent independent SEO/staff-report releases are preserved in the canonical context and receipt branches. Their source and acceptance evidence are separate; the tracking tests above identify the revisions actually tested.
- Each canonical PROJECT_CONTEXT.md records implementation, testing, commit/push, merge, deployment/configuration, live verification and remaining gates. Evidence-only promotion requires normal PR checks and intended-default-branch readback.

## Event and privacy rules

A Lead means an **acknowledged saved enquiry/request**, not a completed lease, payment or unique person. Attempts, failed saves, missing acknowledgements and pending CRM delivery do not emit Lead. Google counts saved requests (the existing MANY_PER_CLICK setting is retained). All three campaigns explicitly select the STOR24 custom goal; its action being secondary at account level is not a defect in that custom goal.

Consent-v4 explicitly covers Google and Meta advertising measurement. Default/refused consent stays denied; accepting enables measurement while personalised advertising and Google Signals remain disabled. Withdrawal clears accessible measurement cookies and the journey. Raw form/contact details, private references and arbitrary queries do not enter the measurement payload. Approved Google click IDs can accompany the initial clean Google address and remain in browser cookies; they are not added to CRM attribution.

The website and CRM share a finite approved register of five campaign slugs, current creatives/cards and purchased keywords. Consented first touch survives public navigation for 30 minutes/up to 12 pages. Internal CRM campaign/link IDs remain distinct from external ad identifiers and spend joins. Unknown or rejected-consent traffic stays unknown. URL tags are visitor-supplied claims, not proof of an authentic platform click. Refresh the register before changing approved ads/keywords.

Dedicated Meta dataset 2256945718217336 belongs to Blend business973585675506776 and STOR24 account1064679099720272. Creation/Business Tools Terms and the dedicated website setup were owner-approved. Automatic matching is off and the portfolio-wide CAPI option stayed off; no CAPI token/customer matching upload was added. Original three unpublished campaign draft objects remain untouched.

The current public paths use booking and micro enquiries. The older QuoteForm has no mounted public-page caller. Its repaired proxy/n8n route is fixture/integration tested; no submitted production legacy quote or n8n/mail delivery is claimed.

## Automated checks and reproduction

The normal hosted workflows cover production builds/images, security, actual booking/form browser regressions and the new matcher compatibility/security tests. Four saved storage/micro rental/viewing producers retain attribution in isolated PostgreSQL; nine booking UI cases include failed/missing acknowledgements and consent/revocation at 1440/390/320. Twelve quote/micro saved/pending/error fixtures and HTTPS privacy/consent checks pass. Those provider/CAPTCHA fixtures remain distinct from the three real saves above.

The five-form cross-repository rehearsal uses actual website handlers/proxy, authenticated CRM and scoped staff report with disposable PostgreSQL. It checks four attributed cases, consent-off unknown, exact saved events, visitor-address forwarding, store isolation and mobile report layout. It rejects production database targets. From CRM:

```sh
MERCHANDISE_DB_TEST=isolated-ci LAUNCH_WEBSITE_ROOT=/path/to/stor24 npx tsx scripts/test-launch-attribution-e2e.ts
```

Supply a disposable merchandise_ci database on localhost separately, Linux Node 24.22.1, generated Prisma client/migrations and Playwright Chromium. CAPTCHA/n8n/measurement transports are fixtures. For canonical Linux snapshots on Windows use git -c core.autocrlf=false archive HEAD.

The minimatch release blocker is repaired by the documented upstream 77a0f5c backport in vendor/minimatch-compat. Original license/provenance and callable/named/class/regex APIs remain. Three actual-consumer/bounded-child tests verify the security limits. No audit exclusion or scanner severity reduction. The rejected 11.x compatibility candidate was never released.

## Remaining launch and acceptance gates

Meta website saved-Lead receipt is independently verified by the fourth real diagnostic save. Ordinary WEB_ONLY Meta reporting now reconciles all three original cases (3 Leads in the 05:00Z hour, observed 06:00:17Z); the redacted provider receipt is launch-tracking-provider-receipt-20261031.json. A genuine Google/Meta paid click and advertising-platform attribution can only be verified after separate owner launch approval; fabricated tags while paused do not prove paid matching. Keep every STOR24 ad paused until that approval.

Actual storage-booking OTP/provider/device and staff/customer UAT remain separate from automated acknowledged-producer tests. All earlier privacy/legal/provider/data/training/payment/access/recovery/business acceptance gates remain in the canonical contexts. No other project tracker or correspondence is in scope.

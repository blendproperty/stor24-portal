# STOR24 launch attribution audit — 30 October 2026

Verdict: NOT READY for reliable campaign-level lead attribution. Audit only; no application fix, ad edit, activation, production submission or provider configuration change was made.

## Scope and immutable sources

- Google Ads customer 5635711564 (Blend Property Group), read through the Google Ads connector.
- Meta account 1064679099720272 (Stor24, ZAR), confirmed against the user's open Ads Manager tab. The connector also lists a separate read-only Stor24 account; findings below concern the open ZAR account.
- Website origin/master: 493b65165dd740b583c652a71875ce502d683193.
- CRM origin/main: 4b8c661073eb0627c1f4644fc7d256400f45796d.
- Website production browser checks used existing valid analytics consent. No consent choice was changed and no lead/reservation/payment was submitted.
- Local source reproduction loaded the exact source files from isolated worktrees, transpiled TypeScript in memory, and evaluated the real acquisition/identifier functions and Zod schema. The reproduction is retained locally in Sitelink/output/stor24-launch-tracking-audit-20261030/reproduce.cjs. No source or production state was changed by it.

## Ad URL audit

Google account auto_tagging_enabled is true. Account tracking template and suffix are empty.

| Campaign | ID | Published status | Effective UTM configuration |
| --- | --- | --- | --- |
| STOR24 Brand Midrand | 24315692802 | PAUSED | Campaign suffix supplies google/cpc, stor24_midrand_brand, numeric campaign ID, creative and ad-group IDs in content, keyword, device/network/location. The enabled child ad has no suffix override, so inherits it. |
| STOR24 Search Midrand | 24315694704 | PAUSED | Campaign suffix supplies google/cpc, stor24_midrand_search, numeric campaign ID, creative/ad-group content, keyword/device/network/location. Three child ads have the same explicit suffix and the fourth inherits the campaign suffix. |
| STOR24 Micro-Warehouse | 24352709658 | PAUSED | No campaign suffix, but enabled ad 828126323236 has google/cpc, stor24_micro_warehouse, creative ID and keyword. Missing utm_id and ad-group identifier. |

All six non-removed STOR24 Google search ads were inspected. Campaign pauses take precedence over enabled child ads. No budget/status changes were made.

Meta published campaign 120253973217080268, STOR24 Round 2 Facebook previews, contains four PAUSED ads. All published ads were enumerated through the connector:

| Ad | ID | URL evidence |
| --- | --- | --- |
| Self-storage carousel | 120253973423350268 | All 5 cards link to /book with facebook/paid_social, campaign stor24_self_storage_round2_20261015, content self-carousel-1 through self-carousel-5. |
| Micro-warehousing carousel | 120253973424890268 | All 6 cards link to /micro-warehousing with facebook/paid_social, campaign stor24_micro_warehousing_round2_20261015, content micro-carousel-1 through micro-carousel-6. Card 4 includes #enquire after the query. |
| Self-storage image | 120253973304300268 | Ads Manager Website URL confirms /book with facebook/paid_social, same self-storage campaign, content self-image. Connector creative response did not expose the single-image URL. |
| Micro-warehousing image | 120253973306780268 | Ad/creative identity and paused status verified. Its editor did not finish rendering destination/tracking fields during inspection; exact single-image URL remains UNVERIFIED. Do not infer this URL from the other ads. |

The inspected Meta URL fields use static Facebook labels, without dynamic campaign/ad-set/ad IDs. If placements expand to Instagram, source must distinguish it. The self-storage image editor and separate unpublished website-carousel draft show blank separate URL parameters fields, but UTMs are embedded in the destination/card URLs: a blank separate field alone does not mean UTMs are absent.

Unpublished website-preview campaign 120253972987910268 contains ad set 120253972987900268 and ad 120253972987920268. Its first carousel card uses the same tagged /book URL and its Tracking section shows Website events Set up. Ads Manager had Review and publish (3) before inspection. Those pre-existing drafts were neither published nor discarded. The draft connector is unavailable for this account, so its single visible subtree was inspected in UI.

## Confirmed blockers

### 1. Existing ad campaign and creative values are discarded

Website app/lib/lead-attribution.ts campaignIdentifiers accepts only /^c[a-z0-9]{24,32}$/ for campaignId and linkId. It reads utm_id then utm_campaign; linkId is read only when campaignId passes. Google numeric IDs, named campaign slugs, numeric creative IDs and Meta carousel labels all fail. utm_term is not retained. CRM src/lib/lead-attribution.ts applies the same internal-ID restriction; marketing-service.ts maps campaignId only to registered MarketingCampaign records in the same facility.

Local reproduction: current Google Search, Google Micro, Meta Self and Meta Micro tag examples all retain normalized source/medium but return an empty identifier object. A valid internal c-prefixed ID control passes. A numeric campaign ID fails CRM validation.

Live production confirmation: Google landing /storage/midpoint retained source google, medium cpc and method utm in sessionStorage, but omitted campaignId/linkId despite the URL containing campaign name, numeric ID, creative/ad-group content and keyword. Its GA4 config/page_view events also omitted campaign_name, campaign_id and campaign_content and used a query-free page_location. A separate live /book tab with the actual self-image Facebook tags retained facebook/paid_social only; its booking_started event likewise omitted campaign details. This is browser capture evidence, not proof of server-side persistence or GA4 ingestion.

### 2. Micro-warehousing attribution is rejected by the CRM path allowlist

The website allows /micro-warehousing, /micro-warehousing/midpoint and /micro-warehousing/book in the journey. CRM publicJourneyPath does not allow any of those routes. Local execution of the exact CRM schema rejects each of the three paths, while the normal /storage/midpoint to /book control passes. public-lead-contract.ts and public-booking-contract.ts use leadAttributionSchema.optional().catch(undefined), so an invalid attribution block is silently removed instead of rejecting the whole enquiry/booking. Consequently even broad source/medium can be lost for the micro journey. This is source/schema reproduction; no production customer submission was used to prove persistence.

### 3. Meta website lead conversion tracking is not established by the inspected setup

The self-storage image and separate website-carousel draft Tracking UI show Website events Set up, without a selected visible dataset. No Meta Pixel/fbq/fbevents integration was found in current website app source. Existing Meta ad-set reporting identifies landing page views, not confirmed CRM leads. There is no demonstrated website Lead event delivery, Pixel/CAPI deduplication or Events Manager test-event proof in this audit. UTMs can label traffic independently of Meta conversion tracking. Do not claim Meta lead optimization/measurement is operational from the presence of UTMs.

## Google conversion configuration — verified correctly scoped

All three STOR24 campaigns use campaign-level custom conversion goal 6459477840, STOR24 Saved website enquiries. That enabled custom goal contains only conversion action 7847049246, STOR24 (web) generate_lead, mapped to GA4 property 556793224/event generate_lead. Website GA_ID G-ECMWM7S5H6 identifies this property in source. Account action 7719385601 belongs to property 532738245 and is NOT the selected custom goal action. Action 7847049246 is marked secondary at account level, but the explicit custom goal includes it; that secondary flag alone is not evidence of incorrect campaign goal setup. Actual GA4 ingestion and a real saved-lead conversion have not been verified.

## Attribution limits that must stay explicit

- Journey retention requires granted optional analytics consent. Denied/absent consent deliberately produces no journey. Never bypass this to improve reporting.
- First acquisition is retained in the tab session, expires after 30 minutes of inactivity, and is not a cross-session or multi-touch attribution system.
- Current website acquisition logic does not infer paid traffic from gclid/fbclid alone; without valid UTM source/medium it falls back to referrer/direct labels.
- No click IDs, CRM-to-platform qualified/won conversions, real submission, outbound message, payment, booking hold or end-to-end database persistence was demonstrated.
- The GA4 event queue is local dispatch evidence, not proof that Google accepted or reported the events.

## Concrete remediation and release gates

1. Align ad links with the CRM's registered campaign/link model, preserving those privacy-safe internal IDs, or implement a separately validated external campaign/ad/ad-set mapping. Do not simply accept arbitrary free-text query strings into analytics or replace internal IDs with unvalidated platform IDs.
2. Add the exact public micro-warehousing routes to the CRM journey allowlist and verify normal and micro enquiry/booking attribution with consent-on, consent-off, navigation and expired-session cases. Invalid optional attribution must not silently become an invisible reporting failure.
3. Standardize Google suffixes and Meta ad/card parameters, retaining campaign, ad group/ad set, ad/creative, card/product and keyword where approved. Verify every final URL and redirect, including the unresolved Meta micro image and existing drafts.
4. Verify GA4 source/campaign and saved-lead events in DebugView/reporting. Confirm one intentionally authorized test enquiry per product in the CRM with matching campaign and content, and confirm failures/attempts are not counted as saved leads.
5. Decide and configure Meta website Lead conversion tracking with appropriate consent and approved dataset, and verify it with Events Manager test evidence before claiming campaign lead optimization.
6. Keep campaigns paused until the tracking release has passed the relevant validation and the owner separately authorizes launch/spend. Audit completion is not launch approval.

No external tracker was in scope. Preserve all existing UAT, privacy/legal, provider, source-data, training, access, payment and approval gates.

## Platform references

- Google auto-tagging: https://support.google.com/google-ads/answer/3095550
- Google campaign-specific/custom goals: https://developers.google.com/google-ads/api/docs/conversions/goals/campaign-goals
- Google ValueTrack mapping: https://developers.google.com/google-ads/api/docs/reporting/valuetrack-mapping

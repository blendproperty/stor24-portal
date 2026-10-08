# STOR24 ABC measurement contract

Updated 8 October 2026. This document describes the implementation contract, not proof of production deployment or complete provider/customer acceptance. Release evidence belongs in PROJECT_CONTEXT.md in both repositories.

## Decisions and scope

- **Acquisition:** compare session channel, source/medium and campaign; inspect engagement and configured GA key events. Registered campaign/link identifiers join the marketing register; arbitrary campaign names and search terms are excluded from client collection. Search Console remains the separate organic search feed.
- **Behaviour:** inspect public pages, safe click destinations and fixed action labels, calculator actions, scroll milestones, active-page time, device performance and generic friction signals.
- **Conversion:** inspect ordered enquiry and unit-reservation funnels, successful acknowledgement pages, errors and optional fixed-choice visitor feedback. CRM enquiries, signed evidence, actual receipts and move-ins retain their own definitions and permissions.
- The ABC panel covers canonical `stor24.co.za` only. It requires all-facility `leads.view` and an exact GA4 organisation binding. A facility filter narrows CRM results; ABC channel/source/campaign/device filters narrow all ABC reports, prior-period comparisons and funnels.
- Analytics is optional and consent-controlled. No session replay, keystroke collection, form contents, contact details, customer/unit/reference identifiers or private account, identity, signing or payment paths are collected. Navigation targets are public allowlisted paths, without queries or fragments. Recognised button labels come from a fixed list, not arbitrary DOM text. Non-public report rows are removed on the server.

## Events

| Event | Trigger / meaning |
| --- | --- |
| `page_view` | A consented public editorial page, once per route transition. |
| `public_link_click` | Navigation to a public page; safe `link_url` and fixed `link_text`. |
| `public_button_click` | A public button; fixed recognised label where available. Unknown labels are omitted. |
| `contact_click`, `booking_cta_click` | Phone/email/WhatsApp and unit-finder links; secondary signals, never conversions. No contact destination details. |
| `scroll_depth` | First crossing of 25/50/75/90% of scrollable height per public page. Counts are milestones, not visitors. |
| `engaged_30_seconds` | At least 30 seconds with the public page visible and browser focused. GA foreground engagement remains the source for duration reports. |
| `storage_*` | Calculator open, item adjustments, packing/recommendation and CTA actions. Arbitrary calculator payloads are discarded. |
| `booking_started` | Consented public unit finder opened; both storage products. |
| `price_viewed` | Loaded map and prices displayed, once per finder visit. Exposure does not prove a price objection. |
| `select_unit` | A displayed map selection, including recommendations/keyboard/default selection; once per unit in the visit. No unit identifier is sent. |
| `booking_details_started` | Customer-details stage opened, once per finder visit. |
| `reservation_requested` | Successful server reservation acknowledgement with a non-empty reference. No reference is transmitted. This is saved reservation, not verified payment. |
| `booking_error` | Public reservation validation, security-check, server or network failure; no raw error message or form content. |
| `enquiry_form_started` | First form focus with analytics permission. No field data. |
| `enquiry_submit` | Enquiry attempt after the security check, before the server request. |
| `generate_lead` | Quote response explicitly confirms a stored CRM lead; Micro response includes its saved lead ID. No ID is sent. |
| `enquiry_delivery_pending` | Quote/enquiry acknowledgement without saved-CRM evidence. Excluded from the saved-lead funnel. |
| `enquiry_error` | Security-check, server or network failure; no raw error details. |
| `feedback_price`, `feedback_availability`, `feedback_timing`, `feedback_help`, `feedback_research` | One optional unit-finder response per displayed feedback widget, only with analytics permission. Fixed answers; no free text. |

Rejecting analytics stops collection and clears accessible GA cookies and the bounded CRM journey. A failed consent save blocks runtime tracking until a successful saved choice. No history before acceptance is backfilled. Direct campaign entries into either unit finder use the same allowlisted source/medium and opaque campaign identifiers as public pages.

## Funnels and reports

1. Unit finder opened → prices viewed → unit selected → details opened → reservation saved.
2. Enquiry started → submitted → stored CRM lead acknowledged.

Google `runFunnelReport` evaluates **closed, ordered user funnels**; users must enter the first step, and every following step must occur within 1,800 seconds of the prior step. Intervening actions are allowed. These are user sequences, potentially across sessions, not a session-only denominator, event-total subtraction or paid-customer conversion rate. Abandonment counts/rates come from the provider's funnel table. A valid empty table means no measured starts; failed/malformed/incomplete reads mean unavailable.

Core reporting reads separate period-wide totals, equal-length prior-period totals, daily sessions/engaged sessions, session acquisition, public-page engagement, actions, devices, conversion/error pages and safe click destinations. Unique users are retrieved as totals, never summed from daily/page rows. Report tables show at most 100 rows and flag truncation. Filtering conversion/action events happens at Google before pagination. Each report can fail independently; missing data remains unavailable. Metadata discloses sampling, privacy thresholding, `(other)` grouping and property time zone where provided. Selected periods contain at most 90 calendar days. New stages collect forward from the public release.

## Interpretation and remaining acceptance

- An exit identifies where ordered progress stopped within the definition; it does not identify motivation. Price/availability/timing feedback reflects self-selected respondents, not representative proportions or causal proof. GA key events depend on the property configuration and are not automatically CRM, revenue or paid move-in counts.
- Rejected consent, blockers, network loss, processing delays and historical untracked actions are coverage gaps. This implementation does not claim every visitor, every click, cross-device identity or all private workflow behaviour.
- Payment-provider referral traffic should be reviewed through Google unwanted-referral settings; do not relabel historical attribution or assume those visits represent fresh acquisition.
- Saved customer conversion ingestion, GA key-event configuration/reconciliation, real customer CAPTCHA/OTP lifecycle, advertising-platform attribution and Meta Pixel/CAPI/reporting retain separate provider/data/UAT gates. Campaign status/budgets are unchanged by this reporting task.

Official definitions: [Google funnel reporting](https://developers.google.com/analytics/devguides/reporting/data/v1/funnels), [funnel request schema](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1alpha/properties/runFunnelReport), [core dimension/metric schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema). The funnel API is alpha; provider failures remain explicit rather than replaced with aggregate arithmetic.

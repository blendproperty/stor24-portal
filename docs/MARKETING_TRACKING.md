# STOR24 marketing measurement — 4 October 2026

The `/marketing` workspace groups campaigns, placement links, online/offline activity and enquiry cohort outcomes. It reads the CRM's actual leads and confirmed reservation-to-tenancy conversions; a manually marked WON lead alone never counts as a move-in.

## Data ownership and measures

- A campaign belongs to one organisation and store. `leads.view` controls reads; `leads.create` controls marketing creation and correction within the stores granted that permission. Property-wide GA4 reporting additionally requires unrestricted store access and the configured organisation ID.
- Enquiries and current move-in outcomes are filtered by enquiry creation date in Africa/Johannesburg. Spend, clicks and impressions are filtered by activity date. These cohorts are shown separately; cost per enquiry/move-in compares period spend with period-created enquiries' current outcomes. It is not finance-ledger revenue, settlement, causal lift or ROAS.
- Every creation and correction has transactional audit evidence. Creation retries use an actor/organisation-scoped UUID, transaction advisory lock and request hash. Changed retry payloads conflict. Corrections use optimistic versions and retain before/after evidence. Campaign store/source/medium remain fixed so existing links do not silently change attribution.
- API reads contain only marketing and aggregate-supporting lead fields, not customer contact or identity information. Results currently cover the latest 20,000 enquiries and 1,000 campaigns; the UI discloses an enquiry limit. Campaign archive/pagination and retention decisions remain future operational work if those limits are approached.

## UTM links and consent

Generated first-party links use the campaign's normalized `utm_source` and `utm_medium`; `utm_id` and `utm_campaign` carry its registered opaque ID. `utm_content` identifies the placement/creative. A keyword label is internal; `utm_term` uses the link ID rather than exposing arbitrary query text. Source and medium are allowlisted. External or private landing routes and URL query strings are rejected.

Only consented public sessions are retained, with a 30-minute inactivity expiry. The first source/campaign in that session persists across public navigation and `/book`; signing, payment, account and private-reference routes remain excluded. Revocation clears the session. Registered campaign/link IDs join to the dashboard only when they exist and match the enquiry's store; unknown or cross-store IDs remain unassigned. No historical attribution is fabricated. Incoming tags are self-reported attribution, not fraud-proof evidence that an ad click occurred.

GA4 receives sanitized public page addresses and allowlisted acquisition tags, with registered IDs only. Automatic page views remain disabled, click tracking remains consent controlled, and no form contents/customer details are sent. Campaign names and keyword labels stay in the internal register.

## GA4 traffic reporting configuration

Website collection already uses property `556793224`. Dashboard traffic reporting is a separate server-only read connection:

1. Enable the Google Analytics Data API in the approved Google Cloud project.
2. Use a dedicated service account with **Viewer** access to that GA4 property only. Do not grant advertising, billing or admin permissions.
3. Configure `GA4_PROPERTY_ID=556793224`, `GA4_ORGANISATION_ID` to the owning STOR24 organisation, and `GA4_SERVICE_ACCOUNT_JSON` as the JSON credential in the restricted server environment. The existing Compose raw env-file passes values server-side. Never put credentials in browser/public env variables or commit them.
4. The dashboard queries aggregate sessions, users and page views plus daily session/page-view values through the read-only API. Access tokens remain server-only; requests time out and failures produce a connection notice, never a fabricated zero. Traffic is property-wide and labelled as such; store filters apply only to CRM/campaign data.
5. Verify a successful authenticated read, reconcile a selected period with GA4 and retain the connection evidence. Google thresholding, processing delays and consent gaps apply. Retain legal/privacy/retention acceptance separately.

API reference verified: https://developers.google.com/analytics/devguides/reporting/data/v1/basics and https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport

## Platform and operational gates

Ad-platform spend/click/impression sync is not connected. Current activity figures are staff-recorded reports, not verified provider data. Google Ads/Meta API authorisation, mapping, deduplicated imports and reconciled report acceptance remain separate connection work. No campaign is published and no ad spend is incurred by this release. Email sends, provider activation, finance, legal/privacy, production UAT, training, data and existing approval gates remain open. Production campaign/link/activity write UAT must use legitimate business records rather than invented live customers or spend.

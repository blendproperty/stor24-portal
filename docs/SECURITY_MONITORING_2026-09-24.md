# Priority 2 security monitoring and encryption follow-up

24 September 2026. P14 remains open. This is technical evidence, not GAPP/POPIA certification or complete CIA acceptance.

## Controls delivered

- Dependabot alerts and automatic security-update pull requests enabled for both repositories. Weekly npm and GitHub Actions update PRs are configured; updates are not automatically merged.
- CRM native CodeQL extended JavaScript/TypeScript/Actions analysis enabled. Initial setup run 36019432923 passed. CRM native secret scanning and push protection were already enabled.
- Both repositories now run dependency audit, Gitleaks and Semgrep checks on changes and weekly. Scanners publish rule/path/line summaries without secret values or source excerpts. Semgrep telemetry is disabled. Gitleaks binary SHA-256 is checked before execution.
- Current tracked checkout scans block changes with new secrets. Scheduled/manual runs also inspect history; unresolved historical secrets remain findings.
- CRM main requires PRs and six successful checks, including for administrators, with force-push/deletion disabled. Private website native branch protection and secret scanning are unavailable under its present GitHub entitlement. No plan purchase or repository visibility change was made.
- Website deployment waits for successful security checks on the exact current master SHA. Manual runs use the same gate. Server checkout uses that verified SHA.
- Four loopback browser-test servers preload fixed brand assets; HTTP request paths no longer become filesystem paths.
- Photo, identity, integration-secret and MFA decryption require 16-byte AES-GCM authentication tags. Encryption format, keys, IVs, writers and record bindings remain unchanged.

## Findings and disposition

| Source | Finding | Disposition and evidence |
|---|---|---|
| CodeQL 1–4 | Path injection in four browser fixture servers | Fixed with preloaded asset maps. All four existing browser workflows pass. Default-branch scan status recorded below. These servers are local test infrastructure, not production routes. |
| CodeQL 5 | HTML tag filter | False positive: negative assertion in invitation-email test, not an HTML sanitizer. Individually dismissed with explanation. |
| CodeQL 6 | TLS chain validation disabled | Exact certificate fingerprint checked before request transmission. Wrong-pin test sends zero HTTP requests, matching pin succeeds. Individually dismissed; matching Semgrep rule suppressed only at that reviewed expression. |
| CodeQL 7 | Weak password hash | False positive: timing-safe comparison of high-entropy API keys after fixed-length hashing, not password persistence. Individually dismissed. |
| CodeQL 8–10 | Weak password hashes | One-time reservation challenge hashing with a server secret, reservation identity and expiry; one synthetic fixture. Not password storage. Individually dismissed. |
| CodeQL 11/13 | Hostname regex | Test assertion on generated SOAP namespace, not production URL validation. Individually dismissed. |
| CodeQL 12 | Remote property injection | Computed own-property object literal using scoped facility ID; no assignment through an attacker-controlled property chain or prototype mutation. Individually dismissed. |
| Semgrep | Missing fixed GCM authentication-tag length | Reproduced: a shortened 4-byte tag was accepted. Fixed in all four readers. Regression rejects 4/8/12/15-byte and modified full-length tags; valid full-tag records still decrypt. |
| Gitleaks CRM history | Nine matches | Exact RFC test vector, synthetic fixture/idempotency values, enum text and Netcash's publicly documented default vendor identifier. Narrow reviewed exceptions; no blanket test-directory exclusion. |
| Gitleaks website history | Browser identifiers and CAPTCHA secret | Public browser identifiers narrowly excluded. Two historical CAPTCHA-secret occurrences remain unresolved; current documentation copy removed. |

## Urgent unresolved credential

Restricted comparison confirmed the CAPTCHA secret in historical website infrastructure documentation matches the running website configuration. Its value is deliberately absent from this record. Source removal does not revoke it.

Required: the Google reCAPTCHA administrator must rotate/revoke that credential, update the server's protected configuration, recreate the website service as needed and verify CAPTCHA success and invalid-token rejection. Identify the correct STOR24 site/account before changing anything; the available personal Google console did not establish that ownership. Do not paste the secret into a ticket, chat, source file or screenshot. History rewriting alone is not remediation.

## Validation and release

- Crypto reproduction failed before patch and passes after. Sixteen focused crypto/ID/photo/MFA/TLS tests pass; typecheck passes. Fresh independent read-only review found no concrete bypass or regression.
- Four affected browser workflow scripts pass with synthetic records. A fresh synthetic credential causes the secret scanner to fail. Summary test confirms source/secret fields are omitted.
- Both final implementation PRs passed their security, build and regression jobs. CRM CodeQL jobs also passed. Initial Semgrep JSX parser gaps were fixed with equivalent escaped text; no parse errors remain.
- CRM PR232 merged as a85c6f1bc9832bf3a05dbbe29731416212774041. Website PR79 merged as 76fe69503039d3cc3af7078979a8f60359d98275.
- CRM deployment 36021625059 succeeded; live container stor24-crm:a85c6f1bc healthy. Website gated deployment 36021427777 succeeded at exact 76fe69503039d3cc3af7078979a8f60359d98275. CRM health/privacy/PAIA/login return 200; public privacy/PAIA and unchecked contact defaults reverified at mobile widths without submission. No private customer records, provider transactions or CAPTCHA-secret rotation were performed.
- Post-merge default-branch CodeQL run 36021368754 passed: zero open alerts, four fixed and nine individually dismissed with source-backed reasons. Both default-branch security workflows passed (CRM 36021368908; website 36021360746). This does not close the separately tracked historical CAPTCHA-secret finding.
- Excel P14 retains Open and zero accepted programme priorities. Urgent credential rotation and this release's evidence were added; existing journey/other priority values, formulas and sheet structure preserved. Recalculation/export/reimport and changed views checked; native Excel interactive acceptance not claimed.

## Remaining programme acceptance

Credential rotation is urgent. GAPP management, approved privacy/PAIA and biometric basis/alternatives, retention/processor decisions, privacy request and preference-change rehearsals, MFA/role UAT, provider/device deletion, encrypted off-system backups, measured restoration, delivered alerts and incident/outage drills remain open. See the operating pack and PRIV/CIA acceptance registers. Scanner success alone cannot close them.

Netcash public default identifier reference: https://api.netcash.co.za/standard-integration/netconnector-setup/

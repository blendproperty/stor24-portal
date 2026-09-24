# Priority 2 technical delivery — 24 September 2026

P14 remains open. This records a technical delivery within the eleven PRIV and nine CIA requirements, not legal certification or overall acceptance.

## Implemented controls

| Area | Change | Evidence boundary |
|---|---|---|
| Public information | Branded anonymous privacy and access-to-information pages in both apps; footer and form links | Interim notice published for review. PAIA contact page is not the formal manual. Contact handling still needs rehearsal. |
| Contact choices | Optional booking channels start off; selected values, purpose, notice edition/hash, timestamp and source are recorded | New/legacy notice attribution tested. Existing account preferences are not silently overwritten by public enquiries. Verified change/withdrawal and actual sending acceptance remain open. |
| Exact facility | Exact target ID intersects organisation and permitted facilities | Real PostgreSQL tests deny other-facility/organisation targets and preserve legitimate owner/assigned access. |
| Permission scope | Leasing reads/workflows retain only facilities granting the required action; mutations have explicit permissions | Synthetic actual-route tests include mixed roles and read-only denials. Full staff-role UAT remains open. |
| Record relationships | Generic patches cannot move records to another facility; customer writes/linking respect facility relationships | New unlinked customers remain available only to their creator until linked. PostgreSQL tests cover legitimate creation/linking and another facility's customer. |
| Staff confidentiality | Access-status relations select only staff ID/name; identity-link listing respects customer facility scope | Populated synthetic PostgreSQL record proves password hash omitted. No production exposure is asserted. |
| Dependencies | CRM Next 16.3.6; public Next 15.5.26; sharp 0.35.4 and patched transitive dependencies | Both full npm audits report zero known findings on 24 September. Framework/library upgrades, schemas and builds tested; no claim of vulnerability-free software. |
| Server files | 408 matching STOR24 dumps and public server environment file restricted to root-only 0600 | Permission readback passed. CRM environment already 0600. Deployment backups now use private umask and pipeline failure checking. Encryption/off-system retention/restore not proven. |

Current-role owner checks were also hardened. Normal role changes already revoke sessions through sessionVersion; this is not presented as a separately proven stale-session exploit.

## Assessment and testing

The completed static scan `5ab61770-353f-4acb-9e35-3539f3c9f43b` reviewed all 141 baseline `src/lib` files, plus supporting callers. It recorded six findings: exact-facility overwrite, discarded permission scope, missing mutation permissions, facility reparenting, customer-write scope and staff-hash serialization. Remediation follows those source findings. Source review did not inspect production records or establish exploitation; it is not an exhaustive audit of all routes, UI, infrastructure or external providers.

- CRM: 383 local tests; typecheck; production build; Prisma generation/validation. Lint: zero errors, ten warnings. New regression tests execute real guards/routes/services with synthetic persistence. Isolated PostgreSQL security tests and the wider transaction/journey workflow passed in CI [36012126025](https://github.com/blendproperty/stor24-portal/actions/runs/36012126025). PR CI [36012126077](https://github.com/blendproperty/stor24-portal/actions/runs/36012126077) and merged-main CI [36012507113](https://github.com/blendproperty/stor24-portal/actions/runs/36012507113) passed.
- Public: 52 local unit tests and 15 booking/floor/privacy browser tests passed locally. Notices and choices checked at 1440/390/320px; CRM anonymous notice pages checked at the same widths. Mobile screenshots inspected. First public CI timed out in the external CAPTCHA-dependent choice fixture; the non-submission test now isolates that external widget and preserves real checkbox assertions. Updated public CI [36013036298](https://github.com/blendproperty/stor24/actions/runs/36013036298) passed.
- Provider acceptance is not covered by these synthetic tests. No real ID/photo, payment, signature, email or gate action was performed.

## Promotion and live verification

CRM [PR 230](https://github.com/blendproperty/stor24-portal/pull/230) merged as `0455f1472ed93a7c880760c2c1d7f0ba27f2ce24`. Public [PR 77](https://github.com/blendproperty/stor24/pull/77) merged as `428270b9735ddb52c218b262a6edaffb331979e8`. CRM deployment [36012746940](https://github.com/blendproperty/stor24-portal/actions/runs/36012746940) and public deployment [36013430247](https://github.com/blendproperty/stor24/actions/runs/36013430247) succeeded. CRM running image `stor24-crm:0455f1472` is healthy; runtime Next versions verified as 16.3.6 and 15.5.26 respectively. Both apps served anonymous privacy/PAIA pages with HTTP 200, one heading and no overflow at 1440/390/320px. Live public booking at 320px displayed four unchecked optional choices and the privacy link; no submission was made. Screenshots inspected. Custom-domain equivalence and authenticated staff UAT remain unverified. Canonical PROJECT_CONTEXT.md records the final dated deployment state; do not infer runtime deployment from a merged source commit.

## Required before P14 check-off

Use [the operating pack](PRIORITY_2_OPERATING_PACK.md), [PRIV-01–11](PRIVACY_GAPP_GAP_REVIEW_2026-09-23.md) and [CIA acceptance](CIA_SECURITY_ACCEPTANCE.md). Still required:

- Legal approval of notices, formal PAIA manual, compulsory biometric basis/alternative/withdrawal handling, necessity and retention schedule.
- Named Information Officer/operational owners, verified processor/transfer contracts and provider/device deletion evidence.
- Rehearsed access/correction/deletion/complaint and preference-change requests, with appropriate retained-record exceptions.
- Complete privileged MFA/recovery and role/facility/customer UAT; financial/provider integrity and actual physical access acceptance.
- Approved recovery targets, encrypted off-system backups, measured isolated restore with deletion reapplication, delivered alerts and incident/provider-outage drills.

Server inspection also found the existing monthly billing scheduled credential does not match the running digest. No credential activation, billing run or schedule change was made. Carry this forward under P02/P03 financial automation acceptance; do not silently enable billing during a security release.

## Tracker verification

The existing Excel working copy was updated on 24 September: P14 stays Open, build/tests/deploy/live remain Partial, and commit/merge evidence for this delivery is Verified. Two evidence rows were appended. Recalculation, formula-error scan, export/reimport, unchanged other-priority and journey values, and rendered changed ranges were checked. No native Excel interactive acceptance was performed. All 14 priorities remain unaccepted.


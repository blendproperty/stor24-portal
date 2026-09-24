# STOR24 CIA security acceptance

24 September progress: see [Priority 2 technical release](PRIORITY_2_RELEASE_2026-09-24.md) for implemented controls and current evidence. The observations below retain their original assessment date. All PRIV and CIA acceptance items remain open; deployed changes do not substitute for legal, provider, staff or recovery acceptance.


Added 23 September 2026 at Brett's request. CIA means Confidentiality, Integrity and Availability. These are mandatory security objectives for the public website, CRM, customer portal and connected payment/access services. CIA is a model, not a standalone certification. This requirements mapping complements the [GAPP review](PRIVACY_GAPP_GAP_REVIEW_2026-09-23.md) and does not replace POPIA/legal approval.

## Evidence boundary

This entry maps existing release evidence and open P01/P02/P03/P04/P10/P11/P12/P13 items to testable requirements. No new source-wide security scan, penetration test, live permission test, restore exercise or provider outage test was performed. Prior encryption/scoping/audit evidence is partial; all acceptance boxes below remain open. Missing operational evidence does not prove a vulnerability. No production setting or code changed.

## Confidentiality — only authorised people see the data

- [ ] **CIA-C1: role, organisation, facility and customer isolation.** Test owner, manager, billing-restricted staff and customers through both screens and direct API/document requests. Denied requests must return no private data, even when URLs/IDs are changed. Revoked roles must stop working in existing sessions. Greyed-out navigation is usability, not access enforcement. Close with an approved permission matrix and negative-test evidence (P01/P10/P11).
- [ ] **CIA-C2: privileged authentication and session protection.** Verify remaining staff/CMS MFA coverage, recovery, expired sessions, logout/revocation, login/OTP throttling and protection of owner-only controls. Verify training mode never grants production rights or mixes live personal data into demonstrations. Close with configuration and owner/manager acceptance evidence (P11/P13).
- [ ] **CIA-C3: encryption, keys and sensitive-data exposure.** Verify TLS, private ID/photo storage, backup encryption, restricted key/secret access and rotation/recovery arrangements. Check logs, exports, browser caches and error responses for unnecessary personal data or credentials. Existing encrypted upload and private-response controls are useful partial evidence, not full coverage. Close with scoped tests and operational ownership (P10/P11).

## Integrity — records and decisions stay accurate and authorised

- [ ] **CIA-I1: financial and booking correctness.** Prove server-side validation of unit, price, dates, permissions and handover prerequisites; replayed/retried requests must not duplicate payments, bookings or charges. Test competing bookings, stale availability and concurrent edits. Reconcile statements and balances to accepted source transactions. Close with transaction/recovery tests and finance acceptance (P01/P02/P03/P12).
- [ ] **CIA-I2: trustworthy integration results and changes.** Verify provider callback authenticity, replay handling and reconciliation; distinguish sandbox/load reports from confirmed payment outcomes. Record who changed key settings and require appropriate authority for financial/access corrections. Verify migration, release and rollback controls. Close with provider and change-control evidence (P03/P04/P11).
- [ ] **CIA-I3: protected audit history and access decisions.** Test ordinary staff cannot rewrite/delete their audit trail; define privileged audit access, monitoring and retention. Ensure approved ID/photo versions and signed agreements remain attributable. Seven-day suspension must use a confirmed failure, reflect settlement/disputes and support authorised review and restoration. Close with tampering/permission tests and live provider acceptance; no automatic suspension is claimed built (P01/P04/P10/P11).

## Availability — services and recovery work when needed

- [ ] **CIA-A1: recoverable backups.** Agree maximum tolerable data loss (RPO) and recovery time (RTO) for booking, finance and access separately. Inventory backup frequency, off-system storage, restricted/immutable copies where appropriate, encryption keys and monitoring. Restore into an isolated environment and verify data consistency, access controls and reapplication of privacy deletions. Close with measured recovery results against approved targets; backup-job success alone does not pass (P10/P11).
- [ ] **CIA-A2: monitoring and incident response.** Prove external uptime/error, database, storage, certificate and critical-job alerts reach a named person; define escalation, patch/dependency handling and incident procedures. Exercise representative failure, rollback and recovery scenarios. Close with delivered alerts, timings and incident drill evidence (P11/P13).
- [ ] **CIA-A3: outage and abuse resilience.** Test bounded traffic/load, rate limiting, resource exhaustion protections and database/provider timeouts in an authorised safe environment. Test two-device offline/reconnect behaviour and delayed/duplicate provider responses. Agree continuity for internet, power, payment and Hikvision outages, including authorised physical access and emergency egress. Do not silently bypass authentication, payment or security checks during failure. Close with technical tests plus an on-site operational drill (P04/P11/P12/P13).

## Build, test and check-off

P11 owns the consolidated CIA acceptance record; linked priorities retain their own gates. Brett assigns operational owners and approves business recovery targets before final acceptance. No recovery time/data-loss target is invented here.

For each CIA ID record: owner; risk/priority; implemented controls; outstanding work; test method/environment/date; evidence; commit/push; merge; deployment/configuration; live verification; reviewer and acceptance date. Mark Not applicable only with documented rationale and approval. Fix and verify one bounded item before proceeding; retain legal/provider/training gates.

Recommended first technical item: CIA-C1/C2 permission and privileged-authentication assessment, coordinated with the open privacy notice/biometric decisions. Availability recovery evidence and financial integrity tests remain required before overall launch acceptance. A separate scoped security audit is still required to validate the code/configuration coverage; this document is not that audit.

## References

- [NIST security objectives / FIPS 199](https://csrc.nist.gov/pubs/fips/199/final) defines confidentiality, integrity and availability objectives. Used as a reference, not a claim STOR24 is subject to US federal certification.
- [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework) provides the broader Govern, Identify, Protect, Detect, Respond and Recover structure for practical controls.
- [NIST backup guidance](https://csrc.nist.gov/pubs/other/2020/04/24/protecting-data-from-ransomware-and-other-data-los/final) supports conducting, maintaining and testing backups.

# STOR24 production readiness checklist

Current assessment: 4 October 2026. See `PRODUCTION_READINESS_2026-10-04.md` for dated baseline evidence, engineering hardening and the remaining acceptance register. The historical September operational scope did not include finance or Hikvision; those remain explicit dependencies for full production readiness.

## Full production acceptance

- [ ] Independent off-server encrypted recovery, key custody and file/configuration coverage verified.
- [ ] Business-approved RPO/RTO and host-loss restore rehearsal completed.
- [ ] Representative isolated workflow peak load, provider outages and cost controls validated.
- [ ] Durable staging and delivered alerts to a named responder verified.
- [ ] Exact-main CI/security/transaction release gate and runtime resource/session limits verified.
- [ ] Compatible-image/configuration rollback rehearsed.
- [ ] Finance/provider reconciliation and physical access acceptance completed where applicable.

## Engineering and deployment

- [ ] Main branch CI passes for the release revision.
- [ ] VPS deployment passes for the same revision.
- [ ] Production health reports both application and database ready.
- [ ] Production monitor is scheduled and its response owner is named.
- [ ] South African dates and reporting boundaries are verified in production.
- [ ] Database backup and rollback location are recorded.

## Operational workflows

- [ ] Public booking is completed through CAPTCHA and OTP and is visible in CRM.
- [ ] Reservation cancellation releases the test unit and produces an audit record.
- [ ] Lead stage notes, ownership and move-in handoff pass.
- [ ] Facility and ownership isolation pass for single- and multi-facility roles.
- [ ] WhatsApp outbound, handset delivery and inbound association pass.
- [ ] BlendSign success and controlled failure/retry pass without duplicate lease email.
- [ ] Approved insurance product configuration and policy lifecycle pass.
- [ ] Operational reports reconcile and export with SAST dates.
- [ ] Offline/two-device reconciliation passes or is explicitly deferred from launch.

## Data, people and launch

- [ ] Authorised legacy export has been validated and rehearsed, or migration is explicitly removed from launch scope.
- [ ] Facility staff, managers and technical owner complete role-based training.
- [ ] UAT evidence and defects are linked from Asana.
- [ ] Critical defects are zero; every accepted non-critical defect has an owner and date.
- [ ] Launch owner records go/no-go and rollback decision in SAST.

## Inputs that cannot be inferred by engineering

- Booking UAT: Brett completes production CAPTCHA and OTP.
- WhatsApp: Brett supplies an approved consenting test recipient.
- BlendSign: Brett approves the controlled retry/resend and recipient immediately before send.
- Insurance: business supplies provider, product, cover, premium, excess and policy wording.
- Migration: data owner supplies the authorised operational legacy export.

Do not mark readiness complete merely because code is deployed. Production evidence and named business sign-off are required.

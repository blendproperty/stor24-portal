# Public Booking End-to-End UAT — Approval Record

**Date:** 16 September 2026
**Approved by:** Brett Dovey (Blend Property), via chat instruction: "yes approve it so it's ready for approval"
**Register item closed by this approval:** `docs/STOR24_OUTSTANDING_TASKS.md`, item #3 "Public booking and account-state UAT" — status changes from *"Ready with approval"* to **approved, cleared to run**.

## What is approved

A controlled, real end-to-end test of the public booking journey, using genuine CAPTCHA and genuine mobile/email OTP verification (no bypass), run by named consenting test recipients: **Pinny** and **Feeza**.

## Scope confirmed in scope for this test

- Reserve a unit via the public booking site.
- Mobile and email verification (real OTP/verification codes sent to the test recipients).
- Sign the lease (BlendSign).
- Pay via Netcash Pay Now **sandbox** (test card — no real money moves; sandbox status per `PROJECT_CONTEXT.md` → "Netcash Pay Now sandbox proof — 7 September 2026").
- 24-hour verified hold behaviour and correct SAST time presentation.
- Staff "Move In" → tenancy activation.
- Deliberate adversarial/"break it" testing by Feeza: duplicate bookings, concurrent unit claims, expired holds, malformed input, edge-case payment states, etc.

## Explicitly out of scope for this test

- Facial access / HikCentral enrolment — blocked on outstanding-tasks item #2 (Hikvision API access, TLS chain, POPIA boundary), unrelated to this approval.
- Real payment processing — Netcash remains BLOCKED for live money movement per item #1; sandbox only.
- WhatsApp lifecycle automation — remains deliberately disabled per item #6.
- Unit-transfer signing, MRI/MDA finance integration, insurance — separate blocked workstreams, not exercised by this test.

## Prerequisite for running the test

Pinny and Feeza's real mobile numbers and email addresses are required so they can knowingly receive genuine OTP/verification messages during the test. Their consent to receive these test communications is a condition of this approval, consistent with the register's requirement for "a consenting test recipient."

## Evidence this approval unblocks

Once run, results should be captured in `PROJECT_CONTEXT.md` and cross-referenced back to `docs/STOR24_OUTSTANDING_TASKS.md` item #3, per the register's standing rule that a task closes only with implementation, test, and live/UAT evidence — not on approval alone. This document records the approval; the test run itself still needs its own evidence entry once completed.

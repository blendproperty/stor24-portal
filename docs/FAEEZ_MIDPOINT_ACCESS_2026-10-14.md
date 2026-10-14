# Faeez Midpoint workflow access

14 October 2026. Meeting item 18 covers the existing Faeez Baboo account at Store 1 - Midpoint. Access configuration and technical authorisation checks are separate from Faeez's own password login and hands-on workflow acceptance.

## Scope and approval separation

Preserve the accepted account, unique custom role and single Midpoint assignment. The previous seven grants are retained. Add exact operations/customer management, inventory viewing, ledger viewing, payment reviewing/receipt recording, collections casework, correction requests, reviewed customer-document sending and relevant reports. The permission editor now exposes six existing backend permissions that previously required broader grants or could not be saved: operations.manage, inventory.view, ledger.view, payments.view, payments.manage and billing.documents.send. No authorisation guard or financial approval policy changes.

Desired grants:

```text
access.view
adjustments.request
adjustments.view
billing.documents.send
billing.view
collections.export
collections.manage
collections.view
communications.view
facility.*
facility_map.view
identity.review
inventory.view
leads.*
ledger.view
move_in.create
operations.manage
operations.view
payments.manage
payments.view
reports.collections
reports.export
reports.financial
reports.sales
reports.view
reservations.*
```

Withhold adjustments.approve, adjustments.record_refund, settlements.approve/manage/import, billing.manage, debit_orders.manage/submit, collections.policy, mri.manage, users.manage, configuration.manage, access.manage/suspend/restore, data.personal_export and ledger.manage. Existing organisation-owner authority remains unchanged. Preparing an adjustment does not post it; independent approval remains required. Ordinary verified receipt recording is allowed, while refunds/corrections use the reviewed adjustment workflow. Personal-data exports still require explicit Super Admin authority, even when report export is granted.

## Login position

Production read-only checks at 12:52 SAST confirm the account is active, has a password, accepted the 18 September invitation and last recorded a successful password login on 20 September. The invitation's historical expiry does not expire the accepted account. Preserve the password/MFA state; changing grants invalidates older sessions through the existing sessionVersion increment. Faeez should sign in using the normal /login page and his existing credentials. His current successful login is still an acceptance gate; no account recreation, password change, reset email or invitation send has been performed.

## Validation and release record

- Implementation: six additional exact permission-editor choices and focused authorisation regressions. No schema migration or approval-rule change.
- Testing: 21 focused checks pass. Full local suite has 768 results, 767 passes, zero failures and one existing optional visual skip. Real component permission selection/save/layout checks pass at 1440/390/320; mobile screenshot inspected. Changed-source ESLint passes. Local shared-dependency typecheck stops on absent qrcode; complete-dependency protected CI/type/build remains required. Earlier dependency-selection failures were corrected before final passing test runs.
- Commit and push: candidate prepared on codex/faeez-midpoint-access-20261014 from fetched main b2fa9c1e7c959c6af84fbf896577f9043bcafbb5; exact source push/context presence checked before handoff.
- Merge: pending protected checks and normal promotion.
- Deployment and configuration: pending normal application release, then the explicitly authorised existing-account permission update. No live access has changed at this checkpoint.
- Live production verification: read-only account/role/invitation/login evidence only at this checkpoint. After configuration, verify unchanged Midpoint scope, expected grants, previous-session invalidation, allowed reads and rejected financial/admin/cross-store operations with no financial/customer/provider mutation.
- Open gates: Faeez password login and actual staff UAT, customer history/notes implementation, approved financial terms, provider/inbox/device/physical-access/legal/privacy/data/training and all existing business/launch approvals. No external tracker is in scope.

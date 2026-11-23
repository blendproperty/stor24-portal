# HikCentral biometric facility access

## Ownership

The CRM owns consent, active-tenancy eligibility, provisioning state, audit and revocation. HikCentral owns the biometric template and door permission. The public website and CMS do not store or process face images in this release.

## Current flow (13 November 2026)

The primary customer can submit a photo through their authenticated customer portal. Additional nominated people can use a five-minute, single-use customer-tablet link issued by authorised staff after an in-person identity check. Each person sees their own consent notice and submits their own photo. Photos are encrypted, short-lived and available to staff for private review. Approval or handover records a pending provider request; **it does not enrol a HikCentral person or grant a door permission**.

The existing `HikCentralAccessProvider.enroll` method is not connected to the reviewed queue. Its face and permission endpoint assumptions do not match the installed v3.0.1 API catalog. Do not call it for production enrolment until its contract, journal, readback and revocation path are replaced and tested.

## Production configuration

Configure the server-only variables documented in `.env.example`. The current CRM settings store an organisation index and door index codes per facility. Never expose the app secret or the facility mapping to the browser. Additional-person capture also requires an approved `ADDITIONAL_ACCESS_POLICIES_JSON` policy, an encryption key and a running photo-expiry worker.

Before enabling writes, compare the installed v3.0.1 templates for person creation with nested `faces`, access-level assignment, application result, person lookup and deletion. Confirm the real organisation and access-level ID, the exact intended Block24 door scope and the device's online state.

## Safe activation checklist

- Confirm POPIA consent wording, retention period, deletion process and a non-biometric access alternative with the accountable business owner.
- Confirm the Midpoint HikCentral organisation index and every intended door index code.
- Use a dedicated least-privilege OpenAPI key permitted only to manage people, faces and access permissions.
- Test with one explicitly authorised person first, after identity and consent checks.
- Read the person and permission back in HikCentral before declaring the integration operational.
- Test revocation and confirm the terminal denies access.
- Apply the Prisma migration, configure secrets through the deployment environment, then deploy the CRM branch.

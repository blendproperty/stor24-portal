# Local identity upload test

This disposable workspace runs the actual customer `IdentityStep` from a sibling public-site checkout and the actual CRM `IdentityReview`, identity service, encryption and expiry worker. It uses an invented, pre-verified booking and a test reviewer in an empty local PostgreSQL database. It does not exercise production authentication, the public Next.js proxy, agreement signing, payments or physical access.

## Start and use

With Node 22+, installed CRM dependencies/generated Prisma client, Docker Desktop and a public-site checkout with its dependencies available:

```powershell
node scripts/identity-upload-lab.mjs "../stor24-booking-workflow-public"
```

Open `http://127.0.0.1:3043`. Download the two sample images, select both in **Customer upload**, acknowledge the test notice and submit. Switch to **Staff review**, select Sample Customer and open both sides before accepting. **Check progress** shows the real ID gates; it never signs or performs handover. Return to Customer upload to test replacement or removal. Only use dummy files: the notice and retention are synthetic test settings, not approved customer policy.

The launcher accepts only a public checkout path. It creates a uniquely named, automatically removed Postgres container on loopback port 55440 with temporary in-memory database storage, a fresh in-memory encryption key and no inherited application/provider settings. It uses the repository's empty-database migration bootstrap. Port 3043 serves the test UI only on loopback, with strict Host/Origin checks, a local HttpOnly session and no-store responses. It must not be exposed through a tunnel or reverse proxy. The shared local session deliberately allows both test personas; it is not real staff authentication or tenant isolation UAT.

Copies expire after one hour, with the real expiry worker running every 30 seconds. Ctrl+C closes the workspace and stops/removes its container. The launcher also closes after four hours. If the launcher is forcibly terminated, stop the uniquely named `stor24-identity-lab-*` container shown by `docker ps`; the temporary database is removed when that container stops. Restarting starts a fresh booking. Generated sample PNGs and screenshots under ignored `output/identity-lab/` contain invented data only.

## Validate

Before handing the workspace to a tester, run against a fresh instance:

```powershell
node scripts/test-identity-upload-lab.mjs
```

This exercises actual uploads, private preview/auditing, acceptance, replacement, withdrawal, stale versions, timed erasure and signing/handover ID gates, plus HTTP boundaries and responsive browser rendering. It changes only the fixed disposable database. Restart the workspace afterwards to give the user an empty booking. Production collection remains subject to its final notice, responsible party/contact, retention, policy configuration, reviewer readiness and enabled production UAT; approval of the ID requirement itself has already been reported.

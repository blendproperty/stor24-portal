# Runtime database role catalog preflight — 2026-10-30

`STOR24_ROLE_TARGET=crm node scripts/check-runtime-database-role.mjs` reads the configured `DATABASE_URL` from the process environment and connects to that database. Supply credentials through the existing protected environment mechanism; do not put connection strings in command arguments or logs. The command returns nonzero if it cannot verify its checks. It prints only named check results and suppresses database error details.

The preflight checks current versus login identity; superuser, BYPASSRLS, role/database creation and replication flags; transitive memberships including assumable NOINHERIT roles; database ownership or CREATE; non-system schema CREATE; and ownership of non-system schemas, relations, functions and types. It conservatively rejects all role memberships. It does not run automatically in application startup or migrations. Builds, migrations and owner credentials must not run this as a runtime check.

A pass does not prove least privilege, correct grants on every object, safe executable or security-definer functions, RLS policies, authentication, application compatibility, backups or recovery. It must not be used as a production-cutover authorization. Existing observed production roles fail the check. Test only in an explicitly configured isolated environment before any rollout.

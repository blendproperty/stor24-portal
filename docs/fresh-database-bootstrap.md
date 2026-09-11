# Fresh database installation

The historical artwork migration precedes the migration that adds its image column. Do not edit applied migration files or delete production migration history.

For a genuinely empty public schema only, set `DATABASE_URL` to the intended new database and explicitly set `ALLOW_EMPTY_DATABASE_BOOTSTRAP=true`, then run:

```sh
node scripts/bootstrap-empty-database.mjs
```

The script refuses a populated public schema. It first runs the normal migrations. If, and only if, the recognised artwork ordering failure occurs with neither image column present, it applies the original prerequisite SQL, registers it with Prisma, marks the failed artwork attempt rolled back, and resumes migration deployment. All other failures stop for investigation.

Do not use this for upgrades, restores, partial installations or existing databases. Normal upgrades continue using `prisma migrate deploy`. If interrupted after partial progress, do not retry blindly or clear tables: inspect migration history and schema first.

Verified on 11 September 2026 in an isolated PostgreSQL CI service, followed by merchandise transaction tests. This is not a production restore rehearsal or a provider payment test.

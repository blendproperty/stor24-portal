# Preparing a missing MRI sandbox connection

Use this operator command only for an organisation authorised to reuse its stored MRI account. Normal authenticated MRI sandbox controls remain available in the application. The command creates a missing configuration; it never replaces one or changes the primary connection.

Prepare a private JSON manifest containing `organisationId`, the primary MRI connection's exact ISO `primaryRevision`, and an operational `maintenanceReference`. Do not put credentials in the manifest. Read the revision from the intended organisation immediately before preview.

```powershell
npx tsx scripts/prepare-mri-sandbox.ts <private-manifest.json>
```

Preview uses database reads, fresh provider authentication and database discovery, and a one-page property read. It requires exactly one `BlendTest` target distinct from the primary target. Output contains verification flags and property count, never credentials, tokens or database identifiers.

After reviewing preview and confirming the intended organisation, enable `MRI_SANDBOX_MAINTENANCE_ENABLED=true` for the operator process only and run the same command with `--apply`. Remove that process flag afterwards. Do not enable it permanently in the application environment.

Apply repeats provider verification and checks the primary revision and configuration under database locks. It atomically inserts encrypted sandbox configuration and a `SYSTEM_MAINTENANCE` audit with no human actor. Existing sandbox settings, stale sources, target changes and audit failures stop the operation. A repeated apply does not overwrite settings. After an uncertain result, inspect the configuration and audit before any retry.

Verify the primary connection is unchanged, exactly one dedicated sandbox exists, and the maintenance audit records the reference. Open the native MRI sandbox workspace using a genuine authorised staff session. An accessible property count of zero confirms connectivity only: MRI must assign a test property before finance can prepare a meaningful journal. This command does not enable posting, approve GL/tax/entity/basis mappings, import data or submit a journal.

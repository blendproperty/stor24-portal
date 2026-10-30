import pg from 'pg';
import { pathToFileURL } from 'node:url';

// A catalog preflight, not proof of least privilege, data isolation or an approved cutover.
export async function runtimeRoleViolations(client) {
  const identity=(await client.query(`SELECT current_user AS current_role, session_user AS login_role,
    r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
    d.datdba = r.oid AS owns_database,
    has_database_privilege(current_user,current_database(),'CREATE') AS database_create
    FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname=current_user AND d.datname=current_database()`)).rows;
  if(identity.length!==1) throw new Error('ROLE_METADATA_UNAVAILABLE');
  const role=identity[0], issues=[];
  if(role.current_role!==role.login_role) issues.push('role_changed');
  for(const key of ['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication','owns_database','database_create']) if(role[key]) issues.push(key);
  const memberships=await client.query(`SELECT 1 FROM pg_roles r WHERE r.rolname<>current_user AND pg_has_role(current_user,r.oid,'MEMBER') LIMIT 1`);
  if(memberships.rowCount) issues.push('role_membership');
  const ownership=await client.query(`SELECT EXISTS (
    SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND t.typowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
  ) AS owned`);
  if(ownership.rows[0].owned) issues.push('owned_objects');
  const schemas=await client.query(`SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(current_user,n.oid,'CREATE') LIMIT 1`);
  if(schemas.rowCount) issues.push('schema_create');
  return issues;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const key=process.env.STOR24_ROLE_TARGET==='crm'?'DATABASE_URL':process.env.STOR24_ROLE_TARGET==='cms'?'DATABASE_URI':null;
  if(!key || !process.env[key]) { console.error('Role preflight requires STOR24_ROLE_TARGET=crm or cms and its runtime database URL'); process.exitCode=1; }
  else {
    const client=new pg.Client({connectionString:process.env[key],connectionTimeoutMillis:5000,statement_timeout:5000});
    try {
      await client.connect(); const issues=await runtimeRoleViolations(client);
      if(issues.length) { console.error(JSON.stringify({catalogPreflightPassed:false,issues}));process.exitCode=1; }
      else console.log(JSON.stringify({catalogPreflightPassed:true,scope:'catalog flags, ownership, memberships and CREATE only; not a complete access or RLS audit'}));
    } catch { console.error('Database role preflight could not complete');process.exitCode=1; }
    finally { await client.end().catch(()=>{}); }
  }
}

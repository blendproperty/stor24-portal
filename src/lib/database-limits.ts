/** Per-process limits. Invalid configuration stops startup instead of removing a bound. */
export function databaseLimits(env: Record<string, string | undefined> = process.env) {
  function bounded(name: string, fallback: number, ceiling: number) {
    const raw = env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw new Error(`INVALID_DATABASE_LIMIT:${name}`);
    }
    return value;
  }
  return {
    max: bounded("DB_POOL_MAX", 10, 50),
    connectionTimeoutMillis: bounded("DB_CONNECTION_TIMEOUT_MS", 5000, 30000),
    idleTimeoutMillis: bounded("DB_POOL_IDLE_TIMEOUT_MS", 30000, 300000),
    statement_timeout: bounded("DB_STATEMENT_TIMEOUT_MS", 30000, 120000),
    idle_in_transaction_session_timeout: bounded("DB_IDLE_TRANSACTION_TIMEOUT_MS", 60000, 300000),
    application_name: "stor24-crm",
  };
}

export function databaseConfig(connectionString: string | undefined, env: Record<string, string | undefined> = process.env) {
  const limits = databaseLimits(env);
  if (!connectionString) return { connectionString, ...limits };
  const url = new URL(connectionString);
  // pg parses URL parameters after the config object; do not let them disable bounds.
  for (const name of Object.keys(limits)) url.searchParams.delete(name);
  return { connectionString: url.toString(), ...limits };
}

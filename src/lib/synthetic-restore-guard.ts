/** This drill is deliberately restricted to the disposable CI service. */
export function syntheticRestoreTarget(env: Record<string, string | undefined>) {
  if (env.GITHUB_ACTIONS !== "true" || env.CI !== "true" || env.MERCHANDISE_DB_TEST !== "isolated-ci" || env.GITHUB_REPOSITORY !== "blendproperty/stor24-portal") throw new Error("Synthetic restore requires the isolated GitHub CI environment.");
  const source = new URL(env.DATABASE_URL ?? "");
  if (source.protocol !== "postgresql:" || source.hostname !== "localhost" || source.port !== "5432" || source.pathname !== "/merchandise_ci" || source.username !== "ci" || source.password !== "ci" || source.search || source.hash) throw new Error("Synthetic restore refuses this database target.");
  if (!/^[a-f0-9]{64}$/.test(env.POSTGRES_CONTAINER ?? "")) throw new Error("Synthetic restore requires the disposable PostgreSQL service container.");
  const restored = new URL(source);
  restored.pathname = "/stor24_restore_ci";
  return { sourceUrl: source.toString(), restoredUrl: restored.toString(), sourceDatabase: "merchandise_ci", restoredDatabase: "stor24_restore_ci", container: env.POSTGRES_CONTAINER! };
}

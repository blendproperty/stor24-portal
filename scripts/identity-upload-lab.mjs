// Local-only disposable lab. Never accepts a caller's database or provider settings.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { access } from "node:fs/promises";

const publicRoot = resolve(process.argv[2] ?? "../stor24-booking-workflow-public");
await access(resolve(publicRoot, "app/components/booking/IdentityStep.tsx"));
const name = `stor24-identity-lab-${process.pid}`;
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || "Docker command failed");
  return result.stdout.trim();
}
let child;
let closing = false;
function cleanup() {
  if (closing) return;
  closing = true;
  child?.kill();
  spawnSync("docker", ["stop", "--time", "2", name], { stdio: "ignore", windowsHide: true });
}
process.once("SIGINT", () => { cleanup(); process.exit(0); });
process.once("SIGTERM", () => { cleanup(); process.exit(0); });
process.once("exit", cleanup);
try {
  docker(["run", "--detach", "--rm", "--name", name, "--publish", "127.0.0.1:55440:5432", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_USER=lab", "--env", "POSTGRES_PASSWORD=local-synthetic-only", "--env", "POSTGRES_DB=stor24_identity_lab", "postgres:16-alpine"]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync("docker", ["exec", name, "pg_isready", "-U", "lab", "-d", "stor24_identity_lab"], { stdio: "ignore", windowsHide: true }).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Test database did not start");
  // Allow only OS/runtime settings; no production credentials or integration flags.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|home|userprofile|appdata|localappdata|comspec|pathext)$/i.test(key)));
  Object.assign(env, {
    DATABASE_URL: "postgresql://lab:local-synthetic-only@127.0.0.1:55440/stor24_identity_lab",
    INTEGRATION_CONFIG_ENCRYPTION_KEY: randomBytes(48).toString("base64url"),
    IDENTITY_LAB: "disposable-local-only", IDENTITY_LAB_PUBLIC_ROOT: publicRoot,
    NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", ALLOW_EMPTY_DATABASE_BOOTSTRAP: "true",
  });
  const migrated = spawnSync(process.execPath, ["scripts/bootstrap-empty-database.mjs"], { env, encoding: "utf8", windowsHide: true });
  if (migrated.status !== 0) throw new Error(migrated.stderr || "Test database migration failed");
  child = spawn(process.execPath, ["--import", "tsx", "scripts/identity-upload-lab/server.ts"], { env, stdio: "inherit", windowsHide: true });
  // This test workspace automatically closes after four hours.
  const timeout = setTimeout(() => { cleanup(); process.exit(0); }, 4 * 3600000);
  const code = await new Promise(resolve => child.once("exit", code => resolve(code ?? 1)));
  clearTimeout(timeout);
  process.exitCode = code;
} finally { cleanup(); }

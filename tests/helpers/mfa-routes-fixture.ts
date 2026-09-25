import { build } from "esbuild";
import { createRequire } from "node:module";

export async function mfaRoutesFixture(database: unknown, hooks: { getSession: () => Promise<unknown>; setSession: (value: unknown) => Promise<void>; getChallenge: () => Promise<string | null>; clearChallenge: () => Promise<void> }) {
  const root = process.cwd().replaceAll("\\", "/");
  const output = await build({ stdin: { contents: 'export {POST as verify} from "./src/app/api/auth/mfa/verify/route";export {POST as manage} from "./src/app/api/auth/mfa/route";export {encryptMfaSecret,hashRecoveryCodes,totpCode} from "./src/lib/mfa";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "mfa-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(db|session|mfa-challenge|request-security)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path.endsWith("/db") ? "export const db=__db;" : a.path.endsWith("/session") ? "export const getSession=__hooks.getSession,setSession=__hooks.setSession;" : a.path.endsWith("/mfa-challenge") ? "export const getMfaChallenge=__hooks.getChallenge,clearMfaChallenge=__hooks.clearChallenge;" : `export {sameOrigin,requestIp,privacyHash} from "${root}/src/lib/request-security.ts";export const rateLimit=async()=>false;`, resolveDir: process.cwd() }));
  } }] });
  const loaded = { exports: {} as { verify: (r: Request) => Promise<Response>; manage: (r: Request) => Promise<Response>; encryptMfaSecret: (secret: string) => string; hashRecoveryCodes: (codes: string[]) => string[]; totpCode: (secret: string) => string } };
  new Function("require", "module", "exports", "__db", "__hooks", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database, hooks);
  return loaded.exports;
}
export const mfaRequest = (body: unknown) => new Request("http://localhost/api/auth/mfa", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": "192.0.2.1" }, body: JSON.stringify(body) });
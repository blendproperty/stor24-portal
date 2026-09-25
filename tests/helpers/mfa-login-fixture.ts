import { build } from "esbuild";
import { createRequire } from "node:module";
import type { MfaChallenge } from "../../src/lib/mfa-challenge";

export async function mfaLoginFixture(database: unknown, session: unknown = null) {
  const jar = new Map<string, string>();
  const sessions: { sessionVersion: number }[] = [];
  let sessionClears = 0;
  const cookies = { get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name: string, value: string) => { jar.set(name, value); }, delete: (name: string) => { jar.delete(name); } };
  const hooks = { getSession: async () => session, setSession: async (value: { sessionVersion: number }) => { sessions.push(value); }, clearSession: async () => { sessionClears++; } };
  const root = process.cwd().replaceAll("\\", "/");
  const output = await build({ stdin: { contents: 'export {POST as login} from "./src/app/api/auth/login/route";export {POST as verify} from "./src/app/api/auth/mfa/verify/route";export {POST as resetPassword} from "./src/app/api/auth/reset-password/route";export {POST as changePassword} from "./src/app/api/auth/change-password/route";export {setMfaChallenge,getMfaChallenge} from "./src/lib/mfa-challenge";', loader: "ts", resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "mfa-login-fixture", setup(b) {
    b.onResolve({ filter: /^(next\/headers|@\/lib\/(db|session|request-security))$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path === "next/headers" ? "export const cookies=async()=>__cookies;" : a.path.endsWith("/db") ? "export const db=__db;" : a.path.endsWith("/session") ? "export const getSession=__hooks.getSession,setSession=__hooks.setSession,clearSession=__hooks.clearSession;" : `export {sameOrigin,requestIp,privacyHash} from "${root}/src/lib/request-security.ts";export const rateLimit=async()=>false;`, resolveDir: process.cwd() }));
  } }] });
  type Route = (r: Request) => Promise<Response>;
  const loaded = { exports: {} as { login: Route; verify: Route; resetPassword: Route; changePassword: Route; setMfaChallenge: (userId: string, version: number) => Promise<void>; getMfaChallenge: () => Promise<MfaChallenge | null> } };
  new Function("require", "module", "exports", "__db", "__cookies", "__hooks", output.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, database, cookies, hooks);
  return { ...loaded.exports, jar, sessions, sessionClears: () => sessionClears };
}

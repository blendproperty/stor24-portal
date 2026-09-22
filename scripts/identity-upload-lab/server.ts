import { createServer } from "node:http";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import sharp from "sharp";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (process.env.IDENTITY_LAB !== "disposable-local-only" || database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.port !== "55440" || database.pathname !== "/stor24_identity_lab") throw new Error("Refusing non-lab database");
  const publicRoot = process.env.IDENTITY_LAB_PUBLIC_ROOT;
  if (!publicRoot) throw new Error("Public component checkout is required");
  const { db } = await import("../../src/lib/db");
  const service = await import("../../src/lib/identity-document-service");
  const { newIdentityAccess, boundedIdentityForm } = await import("../../src/lib/identity-document-security");
  const { identityError } = await import("../../src/lib/identity-document-response");
  if (await db.organisation.count()) throw new Error("Refusing non-empty database; restart the disposable lab");
  const org = await db.organisation.create({ data: { name: "STOR24 synthetic lab", slug: "identity-lab" } });
  const facility = await db.facility.create({ data: { organisationId: org.id, name: "Test store", code: "LAB" } });
  const reviewer = await db.user.create({ data: { organisationId: org.id, email: "reviewer@example.invalid", name: "Test reviewer" } });
  const customer = await db.customer.create({ data: { organisationId: org.id, email: "sample@example.invalid", firstName: "Sample", lastName: "Customer", emailVerifiedAt: new Date() } });
  const type = await db.unitType.create({ data: { facilityId: facility.id, name: "Test unit", features: [] } });
  const unit = await db.unit.create({ data: { facilityId: facility.id, unitTypeId: type.id, number: "TEST 01", monthlyRate: 100, status: "RESERVED" } });
  const access = newIdentityAccess(), reference = "ST24-LOCAL-ID-TEST";
  const booking = await db.reservation.create({ data: { facilityId: facility.id, customerId: customer.id, unitId: unit.id, quotedRate: 100, intendedMoveIn: new Date(), publicReference: "ST24-LOCAL-ID-TEST", contactVerifiedAt: new Date(), holdExpiresAt: new Date(Date.now() + 5 * 3600000), identityAccessHash: access.identityAccessHash, identityAccessExpiresAt: new Date(Date.now() + 5 * 3600000) } });
  const scope = { userId: reviewer.id, organisationId: org.id, facilityIds: [facility.id], unrestrictedFacilities: false };
  process.env.IDENTITY_DOCUMENT_POLICIES_JSON = JSON.stringify({ [org.id]: {
    enabled: true, fullCopyApproved: true, version: "SYNTHETIC-LOCAL-TEST", effectiveFrom: "2020-01-01T00:00:00Z", approvalReference: "Dummy documents only; not legal approval of live wording",
    notice: "TEST WORKSPACE: use only the supplied sample images or invented documents. This test stores encrypted copies in a separate local database, allows a test reviewer to view them and records the review. Copies expire after one hour while the workspace is running; stopping the workspace removes its temporary database. This is not the final customer privacy notice. Do not upload a real identity document.",
    acknowledgementLabel: "I am uploading a sample document, not a real ID, and have read this test notice.", retentionHours: 1, acceptedTypes: ["ID_CARD", "ID_BOOKLET", "PASSPORT"], alternativeContact: "For this test, use the sample downloads above.",
  } });
  await service.expireIdentityDocuments();
  const bundle = await build({ entryPoints: ["scripts/identity-upload-lab/client.jsx"], bundle: true, write: false, format: "esm", jsx: "automatic", alias: { "lab-customer": resolve(publicRoot, "app/components/booking/IdentityStep.tsx"), "lab-review": resolve("src/components/identity-review.tsx"), react: resolve("node_modules/react"), "react-dom": resolve("node_modules/react-dom") } });
  const sourceCss = await readFile(resolve(publicRoot, "app/site-v11.css"), "utf8");
  if (!sourceCss.includes("/* Private identity step:")) throw new Error("Customer stylesheet marker missing");
  const css = `/* Private identity step:${sourceCss.split("/* Private identity step:")[1]}\n${await readFile("src/styles/identity-review.css", "utf8")}`;
  const samples: Record<string, Buffer> = {};
  await mkdir("output/identity-lab", { recursive: true });
  for (const side of ["front", "back"]) {
    samples[`/sample-${side}.png`] = await sharp(Buffer.from(`<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="#eff1e5"/><rect x="35" y="35" width="730" height="530" rx="28" fill="#123c2e"/><g fill="white" font-family="sans-serif" text-anchor="middle"><text x="400" y="160" font-size="48">STOR24 UPLOAD TEST</text><text x="400" y="285" font-size="64">${side.toUpperCase()}</text><text x="400" y="390" font-size="38">SAMPLE ONLY - NOT AN ID</text><text x="400" y="455" font-size="25">No real personal information</text></g></svg>`)).png().toBuffer();
    await writeFile(`output/identity-lab/stor24-test-${side}.png`, samples[`/sample-${side}.png`]);
  }
  const origin = "http://127.0.0.1:3043", host = "127.0.0.1:3043", session = randomBytes(32).toString("base64url");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>STOR24 · ID upload test</title><link rel="stylesheet" href="/lab.css"></head><body><div id="root"></div><script type="module" src="/lab.js"></script></body></html>`;
  const labCss = `@font-face{font-family:'Satoshi Handover';src:url('/brand/Satoshi-Handover-400.woff2');font-weight:400}@font-face{font-family:'Satoshi Handover';src:url('/brand/Satoshi-Handover-700.woff2');font-weight:700}*{box-sizing:border-box}body{margin:0;padding:32px 24px;background:#f5f4ec;color:#09241d;font-family:'Satoshi Handover',sans-serif}#root{max-width:1160px;margin:auto}.lab-header{max-width:850px;margin:0 auto 26px}.lab-brand{font-size:24px;font-weight:700}.lab-brand small{font-size:11px;color:#a44306;letter-spacing:2px;margin-left:12px}.lab-header h1{font-size:clamp(27px,4vw,42px);letter-spacing:-1px;margin:20px 0 10px}.lab-header p{line-height:1.55;max-width:740px}.lab-note{font-size:13px;color:#57665a}.lab-actions,.lab-tabs{display:flex;flex-wrap:wrap;gap:10px}.lab-actions a,.lab-tabs button{font:inherit;font-size:14px;color:#143e2e;border:1px solid #bdcaba;border-radius:24px;padding:12px 18px;background:white;text-decoration:none;cursor:pointer}.lab-tabs{max-width:850px;margin:0 auto 22px}.lab-tabs button[aria-pressed=true]{background:#143e2e;color:white}.lab-result{max-width:850px;margin:16px auto;padding:20px;background:#e4ead9;border-radius:16px;line-height:1.6}.lab-footer{max-width:850px;margin:28px auto;font-size:13px;line-height:1.6;color:#59635b}@media(max-width:500px){body{padding:20px 12px}.lab-actions a,.lab-tabs button{padding:10px 13px}}`;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status: number, content: string | Buffer, type = "application/json") => { res.statusCode = status; res.setHeader("Content-Type", type); res.end(content); };
    if (req.headers.host !== host || (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"])))) return send(403, '{"error":{"message":"Local test only"}}');
    const url = new URL(req.url ?? "/", origin), method = req.method ?? "GET";
    if (!["GET", "POST", "DELETE"].includes(method)) return send(405, "{}");
    if (method !== "GET" && req.headers.origin !== origin) return send(403, '{"error":{"message":"Local test origin required"}}');
    try {
      if (method === "GET" && url.pathname === "/") { res.setHeader("Set-Cookie", `identity_lab=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`); return send(200, html, "text/html; charset=utf-8"); }
      if (!req.headers.cookie?.split("; ").includes(`identity_lab=${session}`)) return send(401, '{"error":{"message":"Open the test workspace first"}}');
      if (method === "GET" && url.pathname === "/lab.js") return send(200, bundle.outputFiles[0].text, "text/javascript");
      if (method === "GET" && url.pathname === "/lab.css") return send(200, css + labCss, "text/css");
      if (method === "GET" && /^\/brand\/Satoshi-Handover-(400|700)\.woff2$/.test(url.pathname)) return send(200, await readFile(resolve(publicRoot, `public${url.pathname}`)), "font/woff2");
      if (method === "GET" && samples[url.pathname]) return send(200, samples[url.pathname], "image/png");
      if (method === "GET" && url.pathname === "/lab/gates") return send(200, JSON.stringify({ sign: await service.identityGate(db, org.id, booking.id, booking.createdAt, "SIGN"), handover: await service.identityGate(db, org.id, booking.id, booking.createdAt, "HANDOVER") }));
      if (url.pathname === "/api/booking/reservations/identity" && url.searchParams.get("reference") === reference) {
        await service.identityStatus(reference, access.token);
        if (method === "POST") {
          const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
          const request = new Request(url, { method, headers, body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } as RequestInit);
          const form = await boundedIdentityForm(request);
          await service.submitIdentity(reference, access.token, { expectedVersion: Number(form.get("expectedVersion")), policyHash: String(form.get("policyHash") ?? ""), acknowledged: form.get("acknowledged") === "true", documentType: String(form.get("documentType") ?? ""), pages: form.getAll("pages") as File[] });
        } else if (method === "DELETE") await service.withdrawIdentity(reference, access.token, Number(url.searchParams.get("version")));
        return send(200, JSON.stringify({ data: await service.identityStatus(reference, access.token) }));
      }
      if (url.pathname === "/api/v1/identity-documents") {
        if (method === "POST") {
          let text = ""; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4096) throw new Error("ID_INVALID"); }
          const body = JSON.parse(text);
          if (typeof body.id !== "string" || !Number.isInteger(body.version) || !["ACCEPT", "REPLACE"].includes(body.decision)) throw new Error("ID_CHANGED");
          await service.reviewIdentity(scope, body.id, body.version, body.decision, body.reason);
          return send(200, '{"data":{"reviewed":true}}');
        }
        if (method !== "GET") return send(405, "{}");
        if (url.searchParams.get("preview") === "true") return send(200, await service.previewIdentity(scope, url.searchParams.get("id") ?? "", Number(url.searchParams.get("version")), Number(url.searchParams.get("page"))), "image/jpeg");
        return send(200, JSON.stringify({ data: await service.listIdentityDocuments(scope) }));
      }
      return send(404, "{}");
    } catch (error) { const response = identityError(error); return send(response.status, await response.text()); }
  });
  server.requestTimeout = 30000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(3043, "127.0.0.1", resolve); });
  let maintaining = false;
  const timer = setInterval(async () => { if (maintaining) return; maintaining = true; try { await service.expireIdentityDocuments(); } catch { console.error("Test expiry maintenance failed; restart the workspace."); } finally { maintaining = false; } }, 30000);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { clearInterval(timer); server.close(); await db.$disconnect(); process.exit(0); });
  console.log(`ID upload test ready: ${origin} (dummy documents only; closes in four hours)`);
}
main().catch(() => { console.error("Could not start the isolated ID test workspace. Check the checkout, database port and browser port."); process.exit(1); });

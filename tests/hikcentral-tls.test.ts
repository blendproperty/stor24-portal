import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import { HikCentralAccessProvider } from "../src/lib/integrations/hikcentral-provider";

test("pinned HikCentral TLS sends no HTTP request before the certificate is accepted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stor24-tls-ci-"));
  const cert = join(directory, "cert.pem"), key = join(directory, "key.pem");
  execFileSync(process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  let requests = 0;
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    requests++; req.resume(); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ code: "0", data: {} }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = { baseUrl: `https://127.0.0.1:${address.port}`, appKey: "ci", appSecret: "ci", facilities: {} };
  try {
    const wrong = new HikCentralAccessProvider(fetch, { ...base, pinnedCertSha256: "00".repeat(32) });
    assert.equal((await wrong.health()).ok, false); assert.equal(requests, 0);
    const correct = new HikCentralAccessProvider(fetch, { ...base, pinnedCertSha256: new X509Certificate(readFileSync(cert)).fingerprint256 });
    assert.equal((await correct.health()).ok, true); assert.equal(requests, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), "stor24-tls-ci-"))));
    rmSync(directory, { recursive: true });
  }
});

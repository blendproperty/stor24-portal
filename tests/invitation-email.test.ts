import assert from "node:assert/strict";
import test from "node:test";
import { invitationEmail } from "../src/lib/invitation-email";
import { sameOrigin } from "../src/lib/request-security";

const sample = { name: 'Brett <script>alert(1)</script>', invitedByName: 'Owner & Team', roleName: 'Organisation owner', inviteUrl: 'https://stor24.example/invite/sample?x=1&y=2', expiresAt: new Date('2026-09-16T12:00:00Z') };

test('invitation email is branded, escaped and has matching HTML and plain text links', () => {
  const email = invitationEmail(sample);
  assert.match(email.subject, /STOR24/);
  assert.match(email.html, /stor24-logo-official-email-20260909\.png/);
  assert.match(email.html, /#ff5a0a/);
  assert.match(email.html, /Accept invitation/);
  assert.match(email.html, /16 September 2026/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /Owner &amp; Team/);
  assert.match(email.html, /x=1&amp;y=2/);
  assert.ok(email.text.includes(sample.inviteUrl));
  assert.match(email.text, /Organisation owner/);
  assert.throws(() => invitationEmail({ ...sample, inviteUrl: 'javascript:alert(1)' }));
});

test('revocation origin guard accepts the configured public origin behind a proxy and rejects untrusted origins', () => {
  const original = process.env.APP_URL;
  process.env.APP_URL = 'https://stor24.example';
  try {
    const request = (origin?: string) => new Request('http://localhost:3000/api/v1/invitations/test', { method: 'DELETE', headers: origin ? { origin } : {} });
    assert.equal(sameOrigin(request('https://stor24.example')), true);
    assert.equal(sameOrigin(request('https://attacker.example')), false);
    assert.equal(sameOrigin(request()), false);
  } finally {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  }
});

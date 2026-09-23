import test from "node:test";
import assert from "node:assert/strict";
import { passwordResetEmail } from "../src/lib/password-reset-email";
test("reset email keeps matching secure links and escapes personalised content",()=>{
 const url="https://stor24.example/reset-password/preview-only?x=1&y=2";
 const email=passwordResetEmail({name:'<img/onerror=alert(1)>',resetUrl:url});
 assert.ok(email.text.includes(url));assert.match(email.html,/x=1&amp;y=2/);
 assert.doesNotMatch(email.html,/<img\/onerror/);assert.match(email.html,/&lt;img/);
 assert.equal((email.html.match(/href="https:\/\/stor24.example\/reset-password\//g)||[]).length,2);
 assert.match(email.html,/30 minutes/);assert.match(email.html,/only be used once/);
 assert.throws(()=>passwordResetEmail({name:"Test",resetUrl:"javascript:alert(1)"}));
});

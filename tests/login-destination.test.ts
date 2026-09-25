import test from "node:test";
import assert from "node:assert/strict";
import { loginDestination } from "../src/lib/login-destination";

test("post-login destinations cannot escape the current origin after normalization", () => {
  for (const value of [null, undefined, "", "//outside.invalid", "///outside.invalid", "/\\outside.invalid", "\\outside.invalid", "/\t/outside.invalid", "/\n/outside.invalid", "/\r/outside.invalid", "/a/..//outside.invalid", "/a/%2e%2e//outside.invalid", "/a\u0000b", "/a\u007fb", "https://outside.invalid", "javascript:alert(1)", " /safe", "relative"]) assert.equal(loginDestination(value), "/", String(value));
  for (const value of ["/", "/customers", "/operations/move-in?reservation=synthetic#checks", "/search?url=https://outside.invalid#results", "/%2f%2foutside.invalid"]) {
    assert.equal(loginDestination(value), value);
    assert.equal(new URL(loginDestination(value), "https://local.invalid").origin, "https://local.invalid");
  }
  assert.equal(loginDestination("/customers/../operations"), "/operations");
});

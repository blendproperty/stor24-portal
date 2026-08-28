import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reservationsWorkspace = readFileSync(
  new URL("../src/components/reservations-workspace.tsx", import.meta.url),
  "utf8",
);

test("reservation move-in action carries the selected reservation into the workflow", () => {
  assert.match(
    reservationsWorkspace,
    /\/operations\/move-in\?reservation=\$\{encodeURIComponent\(item\.id\)\}/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("permanent deletion inventory covers staff references and structured records in the schema", async () => {
  const schema=await readFile("prisma/schema.prisma","utf8"), source=await readFile("src/lib/staff-user-removal.ts","utf8");
  const excluded=new Set(["MfaCredential","PasswordResetToken","RoleAssignment","AuditEvent"]);
  for (const model of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [,name,body]=model;
    if (excluded.has(name)) continue;
    const delegate=name[0].toLowerCase()+name.slice(1);
    for (const field of body.matchAll(/^\s*(\w+)\s+(String\??)(?=\s|$)/gm)) {
      const key=field[1];
      if (["authorId","assignedToId","ownerId","assigneeId","coverId","actorId","userId","controllerUserId","approverId"].includes(key)||key.endsWith("ById")) {
        assert.match(source,new RegExp(`tx\\.${delegate}\\.findFirst\\([^\\n]*\\b${key}: userId\\b`),`${name}.${key} requires deletion review`);
      }
    }
    for (const field of body.matchAll(/^\s*(\w+)\s+Json\??(?=\s|$)/gm)) {
      assert.ok(source.includes(`FROM "${name}" WHERE`) && source.includes(`in "${field[1]}"::text`),`${name}.${field[1]} requires deletion review`);
    }
  }
});

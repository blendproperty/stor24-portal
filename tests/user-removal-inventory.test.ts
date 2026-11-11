import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("permanent deletion inventory covers staff references and structured records in the schema", async () => {
  const schema=await readFile("prisma/schema.prisma","utf8"), source=await readFile("src/lib/staff-user-removal.ts","utf8"), migration=await readFile("prisma/migrations/20261110130000_staff_deletion_fence/migration.sql","utf8");
  const excluded=new Set(["MfaCredential","PasswordResetToken","RoleAssignment","AuditEvent"]);
  for (const model of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [,name,body]=model;
    if (excluded.has(name)) continue;
    const delegate=name[0].toLowerCase()+name.slice(1);
    for (const relation of body.matchAll(/^\s*\w+\s+User\??\s+@relation\([^\n]*fields:\s*\[([^\]]+)\]/gm)) {
      const key=relation[1].trim();
      assert.match(source,new RegExp(`tx\\.${delegate}\\.findFirst\\([^\\n]*\\b${key}: userId\\b`),`${name}.${key} requires dependency review`);
      assert.match(migration,new RegExp(`CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF [^\n]*"${key}"[^\n]* ON public\."${name}"`),`${name}.${key} requires a write fence`);
    }
    for (const field of body.matchAll(/^\s*(\w+)\s+(String\??)(?=\s|$)/gm)) {
      const key=field[1];
      if (["authorId","assignedToId","ownerId","assigneeId","coverId","actorId","userId","controllerUserId","approverId"].includes(key)||key.endsWith("ById")) {
        assert.match(source,new RegExp(`tx\\.${delegate}\\.findFirst\\([^\\n]*\\b${key}: userId\\b`),`${name}.${key} requires deletion review`);
        assert.match(migration,new RegExp(`CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF [^\n]*"${key}"[^\n]* ON public\."${name}"`),`${name}.${key} requires a write fence`);
      }
    }
    for (const field of body.matchAll(/^\s*(\w+)\s+(?:Json\??|String\[\])(?=\s|$)/gm)) {
      assert.ok(source.includes(`FROM "${name}" WHERE`) && source.includes(`in "${field[1]}"::text`),`${name}.${field[1]} requires deletion review`);
      assert.match(migration,new RegExp(`CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF [^\n]*"${field[1]}"[^\n]* ON public\."${name}"`),`${name}.${field[1]} requires a write fence`);
    }
  }
  for (const field of ["actorId","before","after"]) assert.match(migration,new RegExp(`CREATE TRIGGER "staff_ref_check" BEFORE INSERT OR UPDATE OF [^\n]*"${field}"[^\n]* ON public\."AuditEvent"`));
  assert.ok(source.includes("tx.auditEvent.findFirst"), "business audit actors still block deletion");
  assert.equal((migration.match(/CREATE FUNCTION public\."stor24_staff_ref_/g)||[]).length,(migration.match(/REVOKE ALL ON FUNCTION public\."stor24_staff_ref_/g)||[]).length);
  assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.stor24_staff_reference_statement() FROM PUBLIC"));
});

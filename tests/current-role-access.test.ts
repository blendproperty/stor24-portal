import assert from "node:assert/strict";
import test from "node:test";
import { currentRoleAccess } from "../src/lib/current-role-access.ts";
const assignment = (name: string, facilityId: string | null, permissions: string[] = []) => ({facilityId, role:{name,permissions}});
test("removing owner assignment removes owner bypass immediately", () => {
 assert.equal(currentRoleAccess([assignment("Organisation owner",null)],"billing.manage").allowed,true);
 const demoted=[assignment("Facility manager","a",["units.view"])];
 assert.equal(currentRoleAccess(demoted,"billing.manage").allowed,false);
 assert.equal(currentRoleAccess(demoted).owner,false);
 assert.equal(currentRoleAccess([],"users.manage").allowed,false);
});
test("facility owner-like names and unrelated assignments do not widen permission scope", () => {
 assert.equal(currentRoleAccess([assignment("Organisation owner","a")],"billing.manage").allowed,false);
 const roles=[assignment("Manager","a",["units.view"]),assignment("Finance","b",["billing.manage"])];
 assert.equal(currentRoleAccess(roles,"billing.manage","a").allowed,false);
 assert.deepEqual(currentRoleAccess(roles,"billing.manage").allowedFacilityIds,["b"]);
 assert.equal(currentRoleAccess(roles,"units.update","a").allowed,false);
});
test("explicit organisation-wide and scoped wildcard grants retain their intended scope", () => {
 assert.equal(currentRoleAccess([assignment("Finance",null,["billing.*"])],"billing.manage","a").allowedFacilityIds,null);
 assert.deepEqual(currentRoleAccess([assignment("Viewer","a",["*.view"])],"units.view").allowedFacilityIds,["a"]);
 assert.equal(currentRoleAccess([assignment("Viewer","a",["*.view"])],"units.delete").allowed,false);
});

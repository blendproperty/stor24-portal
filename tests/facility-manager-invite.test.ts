import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("unscoped and invalid facility manager invitations cannot be created or accepted", async () => {
  let facilityCode: string | null = null;
  let writes = 0;
  const database = {facility:{findUnique:async()=>null},userInvitation:{findUnique:async()=>({roleName:"Facility manager",facilityCode,organisationId:"org",status:"PENDING",expiresAt:new Date(Date.now()+60000)})},role:{findUnique:async()=>({id:"role"})},$transaction:async()=>{writes++;}};
  const mock: Record<string,string> = {
    "@/lib/db":"export const db=__db;",
    "@/lib/auth-guards":"export const requireOwner=async()=>({user:{id:'owner',organisationId:'org'}});",
    "@/lib/invitation-service":"export const hashInvitationToken=x=>x;export const createInvitationToken=()=>'';export const expireOldInvitations=async()=>{};",
    "@/lib/email":"export const emailProvider=()=>({send:async()=>{}});",
    "@/lib/invitation-email":"export const invitationEmail=()=>({});",
    "@/lib/session":"export const setSession=async()=>{};",
  };
  const load=async(entry:string)=>{const result=await build({entryPoints:[entry],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"invite-scope",setup(b){b.onResolve({filter:/^@\/lib\//},a=>Object.hasOwn(mock,a.path)?{path:a.path,namespace:"fixture"}:undefined);b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:mock[a.path]}));}}]});const mod={exports:{} as {POST:(r:Request)=>Promise<Response>}};new Function("require","module","exports","__db",result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports,database);return mod.exports;};
  const create=await load("src/app/api/v1/invitations/route.ts"), accept=await load("src/app/api/v1/invitations/accept/route.ts");
  const req=(body:unknown)=>new Request("https://example.invalid/api",{method:"POST",headers:{origin:"https://example.invalid"},body:JSON.stringify(body)});
  for (const code of ["", "INVALID"]) assert.equal((await create.POST(req({name:"Synthetic Staff",email:"staff@example.invalid",roleName:"Facility manager",facilityCode:code}))).status,422);
  for (const code of [null,"INVALID"]) {facilityCode=code; assert.equal((await accept.POST(req({token:"a".repeat(43),password:"AstrongPassword1!"}))).status,409);}
  assert.equal(writes,0);
});

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { currentRoleAccess } from "./current-role-access";
import { ReportError } from "./visual-report-engine";
import type { ReportDataset } from "./visual-report-contract";
import type { RequestScope } from "./scope";

type Assignment = Parameters<typeof currentRoleAccess>[0][number];
export function visualReportScope(assignments:Assignment[],dataset:ReportDataset,userId:string,organisationId:string,facilityId?:string,exporting=false):RequestScope {
  const permissions=[dataset.permission,...(dataset.extraPermission?[dataset.extraPermission]:[]),...(exporting?["reports.export"]:[])];
  let allowed:string[]|null=null;
  for(const permission of permissions) {
    const access=currentRoleAccess(assignments,permission,facilityId);
    if(!access.allowed) throw new ReportError("FORBIDDEN");
    if(access.allowedFacilityIds!==null) allowed=allowed===null?access.allowedFacilityIds:allowed.filter(id=>access.allowedFacilityIds!.includes(id));
  }
  if(allowed!==null && !allowed.length)throw new ReportError("FORBIDDEN");
  if(facilityId && allowed!==null && !allowed.includes(facilityId))throw new ReportError("FACILITY_FORBIDDEN");
  return {userId,organisationId,facilityIds:allowed??[],unrestrictedFacilities:allowed===null};
}
export function personalReportAccess(assignments:Assignment[],scope:RequestScope,facilityId?:string) {
  const access=currentRoleAccess(assignments,"data.personal_export",facilityId);
  return access.allowed && (access.allowedFacilityIds===null || (!scope.unrestrictedFacilities && scope.facilityIds.every(id=>access.allowedFacilityIds!.includes(id))) || (!!facilityId && access.allowedFacilityIds.includes(facilityId)));
}
function key() {
  const secret=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY?.trim();
  if(!secret || secret.length<32)throw new ReportError("REPORT_STORAGE_UNAVAILABLE");
  return createHash("sha256").update(`stor24:report-artifact:v1:${secret}`).digest();
}
export function encryptReportArtifact(value:string,binding:string) {
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(),iv);cipher.setAAD(Buffer.from(binding));
  const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),bytes.toString("base64url")].join(".");
}
export function decryptReportArtifact(value:string,binding:string) {
  const [v,iv,tag,data,extra]=value.split(".");
  if(v!=="v1"||!iv||!tag||!data||extra)throw new ReportError("REPORT_STORAGE_UNAVAILABLE");
  const cipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64url"));cipher.setAAD(Buffer.from(binding));cipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([cipher.update(Buffer.from(data,"base64url")),cipher.final()]).toString("utf8");
}

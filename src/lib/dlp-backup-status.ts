import { readFile } from "node:fs/promises";
import path from "node:path";
export async function dlpBackupStatus() {
  const root=process.env.DLP_BACKUP_STATUS_PATH;
  if(!root)return {fresh:false,completedAt:null,restoredAt:null,offSite:false};
  try {
    const latest=JSON.parse(await readFile(path.join(root,"latest.json"),"utf8"));
    const completedAt=typeof latest.completedAt==="string" && Number.isFinite(Date.parse(latest.completedAt)) ? latest.completedAt as string : null;
    let restoredAt:string|null=null;
    try { const proof=JSON.parse(await readFile(path.join(root,"restore-proof.json"),"utf8")); if(proof.status==="restored" && proof.productionDatabaseModified===false && typeof proof.verifiedAt==="string" && Number.isFinite(Date.parse(proof.verifiedAt)))restoredAt=proof.verifiedAt; }catch{}
    const age=completedAt ? Date.now()-Date.parse(completedAt) : Infinity;
    return {fresh:latest.status==="verified" && latest.encrypted===true && age>=0 && age<26*3600000,completedAt,restoredAt,offSite:latest.offSite===true};
  }catch{return {fresh:false,completedAt:null,restoredAt:null,offSite:false};}
}

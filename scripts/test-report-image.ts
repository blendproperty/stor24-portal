import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import ExcelJS from "exceljs";
import {db} from "../src/lib/db";
import {createSessionToken,sessionCookieName} from "../src/lib/session";
import {southAfricaDateKey} from "../src/lib/south-africa-time";

async function main(){
  assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");
  const database=new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname,"localhost");
  assert.equal(database.pathname,"/image_reports");
  assert.ok(process.env.AUTH_SECRET?.startsWith("synthetic-"));
  const origin=new URL(process.env.REPORT_IMAGE_TEST_ORIGIN!);
  assert.equal(origin.protocol,"http:");assert.equal(origin.hostname,"127.0.0.1");assert.equal(origin.port,"3197");
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    try{const response=await fetch(new URL("/api/health",origin),{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{/* wait for the isolated image */}
    await setTimeout(500);
  }
  assert.ok(ready,"The isolated production image did not become ready");
  const nonce=randomUUID();let organisationId:string|undefined;
  try{
    const organisation=await db.organisation.create({data:{name:"Synthetic image export",slug:nonce}});organisationId=organisation.id;
    const facility=await db.facility.create({data:{organisationId,name:"Synthetic image store",code:nonce}});
    const type=await db.unitType.create({data:{facilityId:facility.id,name:"Synthetic type",features:[],areaSqMetres:9}});
    await db.unit.create({data:{facilityId:facility.id,unitTypeId:type.id,number:"SYNTHETIC-IMAGE-UNIT",monthlyRate:"1234.56"}});
    const role=await db.role.create({data:{organisationId,name:"Synthetic image exporter",permissions:["reports.view","reports.export","data.personal_export"]}});
    const user=await db.user.create({data:{organisationId,name:"Synthetic image actor",email:nonce+"@example.invalid",passwordHash:"synthetic-image-only",roleAssignments:{create:{roleId:role.id,facilityId:facility.id}}}});
    const token=await createSessionToken({userId:user.id,name:user.name,email:user.email,role:role.name,sessionVersion:user.sessionVersion,mfaVerified:true});
    const day=southAfricaDateKey(new Date()),query=new URLSearchParams({reportKey:"unit-availability",facilityId:facility.id,from:day,to:day,format:"XLSX"});
    const endpoint=new URL("/api/v1/reports/export?"+query,origin);
    assert.equal((await fetch(endpoint,{redirect:"manual",signal:AbortSignal.timeout(15000)})).status,401);
    const headers={cookie:`${sessionCookieName}=${token}`};
    const response=await fetch(endpoint,{headers,redirect:"manual",signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,"Compiled report route must release XLSX for the synthetic authorised actor");
    assert.match(response.headers.get("content-type")??"",/spreadsheetml/);
    assert.match(response.headers.get("cache-control")??"",/private.*no-store/);
    const bytes=await response.arrayBuffer();assert.equal(Buffer.from(bytes).subarray(0,2).toString(),"PK");
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
    const cells:string[]=[];for(const sheet of workbook.worksheets)sheet.eachRow(row=>row.eachCell(cell=>cells.push(String(cell.value))));
    assert.ok(cells.includes("SYNTHETIC-IMAGE-UNIT"));assert.ok(cells.includes("Synthetic image store"));
    assert.equal(await db.auditEvent.count({where:{organisationId,action:"dlp.export.allowed"}}),1);
    assert.equal(await db.customer.count({where:{organisationId}}),0);
    assert.equal(await db.communicationLog.count({where:{organisationId}}),0);
    await db.role.update({where:{id:role.id},data:{permissions:["operations.view"]}});
    assert.equal((await fetch(endpoint,{headers,redirect:"manual",signal:AbortSignal.timeout(15000)})).status,403,"Compiled route must recheck a revoked report grant");
    console.log(JSON.stringify({productionImageXlsx:true,syntheticUnitReadBack:true,anonymous:401,revoked:403,privateNoStore:true,bytes:bytes.byteLength,customers:0,providerMessages:0}));
  }finally{
    if(organisationId){await db.rateLimitBucket.deleteMany({where:{key:{startsWith:`dlp:${organisationId}:`}}});await db.organisation.delete({where:{id:organisationId}});}
    await db.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

import { createHash,timingSafeEqual } from "node:crypto";
import { runScheduledReports } from "@/lib/visual-report-worker";
import { dlpPrivateHeaders } from "@/lib/dlp-policy";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  const configured=process.env.REPORT_CRON_SECRET_SHA256,presented=request.headers.get("x-cron-key");
  if(!configured||!/^[a-f0-9]{64}$/i.test(configured))return Response.json({error:{code:"REPORT_WORKER_UNAVAILABLE"}},{status:503,headers:dlpPrivateHeaders});
  if(!presented||presented.length>4096||!timingSafeEqual(createHash("sha256").update(presented).digest(),Buffer.from(configured,"hex")))return Response.json({error:{code:"UNAUTHENTICATED"}},{status:401,headers:dlpPrivateHeaders});
  try {const result=await runScheduledReports();return Response.json({data:result},{status:result.failed?503:200,headers:dlpPrivateHeaders});}
  catch{return Response.json({error:{code:"REPORT_WORKER_FAILED"}},{status:503,headers:dlpPrivateHeaders});}
}

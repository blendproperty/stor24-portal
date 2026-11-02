import {createHash,timingSafeEqual} from 'node:crypto';
import {processMetaConversions} from '@/lib/meta-conversions';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 const configured=process.env.REPORT_CRON_SECRET_SHA256,presented=request.headers.get('x-cron-key');
 if(!configured||!/^[a-f0-9]{64}$/i.test(configured))return Response.json({error:{code:'WORKER_UNAVAILABLE'}},{status:503,headers});
 if(!presented||presented.length>4096||!timingSafeEqual(createHash('sha256').update(presented).digest(),Buffer.from(configured,'hex')))return Response.json({error:{code:'UNAUTHENTICATED'}},{status:401,headers});
 try{return Response.json({data:await processMetaConversions()},{headers});}catch{return Response.json({error:{code:'DELIVERY_UNAVAILABLE'}},{status:503,headers});}
}

import {metaConnection} from "@/lib/advertising-connection";
import {requirePermissionScope} from '@/lib/scope';
import {apiError} from '@/lib/api';
import {googleAdvertising,metaAdvertising} from '@/lib/marketing-ads';
import {southAfricaDateKey} from '@/lib/south-africa-time';
import {z} from 'zod';
export async function GET(request:Request){try{
 const scope=await requirePermissionScope('leads.view');
 if(!scope.unrestrictedFacilities||scope.organisationId!==process.env.ADVERTISING_ORGANISATION_ID)throw Error('FORBIDDEN');
 const p=new URL(request.url).searchParams,range=z.object({from:z.iso.date(),to:z.iso.date()}).safeParse({from:p.get('from'),to:p.get('to')});
 if(!range.success||range.data.from>range.data.to||range.data.to>southAfricaDateKey(new Date())||Date.parse(range.data.to)-Date.parse(range.data.from)>90*86400000)return Response.json({error:{message:'Choose up to 90 days ending today or earlier.'}},{status:422,headers:{'Cache-Control':'private, no-store'}});
 const {from,to}=range.data;return Response.json({data:await Promise.all([googleAdvertising(from,to),metaAdvertising(from,to,await metaConnection(scope.organisationId))])},{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return apiError(e);}}

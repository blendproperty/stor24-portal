import {requireOwner,authErrorResponse} from '@/lib/auth-guards';
import {sameOrigin} from '@/lib/request-security';
import {leadSlaView,saveLeadSla} from '@/lib/lead-sla-service';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, max-age=0, private'};
function error(e:unknown){if(e instanceof Error&&e.message.startsWith('SLA_'))return Response.json({error:{message:e.message.replaceAll('_',' ').toLowerCase()}},{status:409,headers});return authErrorResponse(e);}
export async function GET(request:Request){try{const a=await requireOwner(),f=new URL(request.url).searchParams.get('facilityId');if(!f)return Response.json({error:{message:'Select a facility.'}},{status:422,headers});return Response.json({data:await leadSlaView(a.user.organisationId,f)},{headers});}catch(e){return error(e);}}
export async function POST(request:Request){try{if(!sameOrigin(request))return Response.json({error:{message:'Request rejected.'}},{status:403,headers});const a=await requireOwner(),b=await request.json();if(typeof b.facilityId!=='string'||!(b.revision===null||typeof b.revision==='string'))return Response.json({error:{message:'Invalid configuration.'}},{status:422,headers});return Response.json({data:await saveLeadSla(a.user.organisationId,a.userId,b.facilityId,b.policy,b.revision)},{headers});}catch(e){return error(e);}}

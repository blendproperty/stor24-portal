import {requireOwner,authErrorResponse} from '@/lib/auth-guards';
import {sameOrigin} from '@/lib/request-security';
import {jsonBody} from '@/lib/api';
import {configureMetaConversions,disableMetaConversions,metaConversionStatus,processMetaConversions} from '@/lib/meta-conversions';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){try{const a=await requireOwner();if(a.user.organisationId!==process.env.ADVERTISING_ORGANISATION_ID)throw Error('FORBIDDEN');return Response.json({data:await metaConversionStatus(a.user.organisationId)},{headers});}catch(e){return authErrorResponse(e);}}
export async function POST(request:Request){try{
  if(!sameOrigin(request))return Response.json({error:{message:'Request rejected.'}},{status:403,headers});
  const a=await requireOwner();if(a.user.organisationId!==process.env.ADVERTISING_ORGANISATION_ID)throw Error('FORBIDDEN');
  const b=await jsonBody(request) as Record<string,unknown>;
  if(b?.action==='disable'){await disableMetaConversions(a.user.organisationId,a.userId);return Response.json({data:await metaConversionStatus(a.user.organisationId)},{headers});}
  if(b?.action==='send'){await processMetaConversions();return Response.json({data:await metaConversionStatus(a.user.organisationId)},{headers});}
  if(typeof b?.token!=='string'||!/^[A-Za-z0-9_-]{32,8192}$/.test(b.token)||typeof b.testEventCode!=='string'||!/^TEST[0-9A-Za-z]{1,40}$/.test(b.testEventCode))return Response.json({error:{message:'Enter the STOR24 dataset access token and its Test Events code.'}},{status:422,headers});
  if(!await configureMetaConversions(a.user.organisationId,a.userId,b.token,b.testEventCode))return Response.json({error:{message:'Meta did not accept the test event. Check the dataset token and Test Events code.'}},{status:422,headers});
  return Response.json({data:await metaConversionStatus(a.user.organisationId)},{headers});
}catch(e){return authErrorResponse(e);}}

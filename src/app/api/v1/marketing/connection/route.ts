import {requireOwner,authErrorResponse} from '@/lib/auth-guards';
import {sameOrigin} from '@/lib/request-security';
import {jsonBody} from '@/lib/api';
import {metaConnection,saveMetaConnection} from '@/lib/advertising-connection';
import {metaAdvertising} from '@/lib/marketing-ads';
import {southAfricaDateKey} from '@/lib/south-africa-time';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){try{const a=await requireOwner();if(a.user.organisationId!==process.env.ADVERTISING_ORGANISATION_ID)throw Error("FORBIDDEN");return Response.json({data:{metaConfigured:!!await metaConnection(a.user.organisationId),account:'1064679099720272'}},{headers});}catch(e){return authErrorResponse(e);}}
export async function POST(request:Request){try{
 if(!sameOrigin(request))return Response.json({error:{message:'Request rejected.'}},{status:403,headers});
 const a=await requireOwner();if(a.user.organisationId!==process.env.ADVERTISING_ORGANISATION_ID)throw Error('FORBIDDEN');
 const b=await jsonBody(request);if(!b||typeof b!=='object'||!('token' in b)||typeof b.token!=='string'||!/^[A-Za-z0-9_-]{32,8192}$/.test(b.token))return Response.json({error:{message:'Enter a valid server reporting access token.'}},{status:422,headers});
 const today=southAfricaDateKey(new Date()),report=await metaAdvertising(today,today,{account:'1064679099720272',token:b.token,version:'v25.0'});
 if(report.status!=='connected')return Response.json({error:{message:'The token could not read the verified STOR24 account. Check ads_read access before saving.'}},{status:422,headers});
 await saveMetaConnection(a.user.organisationId,a.userId,b.token);return Response.json({data:{metaConfigured:true}},{headers});
}catch(e){return authErrorResponse(e);}}

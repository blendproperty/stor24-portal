import {importPKCS8,SignJWT} from 'jose';
export type AdvertisingRow={provider:'Google Ads'|'Meta';campaignId:string;name:string;date:string;currency:string;spend:number;impressions:number;clicks:number;conversions:number|null};
export type AdvertisingFeed={provider:string;status:'connected'|'unconfigured'|'unavailable';message:string;rows:AdvertisingRow[];retrievedAt:string|null};
const unavailable=(provider:string,status:'unconfigured'|'unavailable'):AdvertisingFeed=>({provider,status,message:status==='unconfigured'?`${provider} needs a server reporting connection.`:`${provider} reporting is unavailable. Retry or check the connection.`,rows:[],retrievedAt:null});
export function googleAdvertisingQuery(from:string,to:string,ids:string){
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(from)||!/^20\d{2}-\d{2}-\d{2}$/.test(to)||!/^\d+(,\d+){0,99}$/.test(ids))throw Error('INVALID_ADS_QUERY');
 return `SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, customer.currency_code FROM campaign WHERE campaign.id IN (${ids}) AND segments.date BETWEEN '${from}' AND '${to}' ORDER BY segments.date LIMIT 10000`;
}
function metric(value:unknown){const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('INVALID_ADS_METRIC');return n;}
export async function googleAdvertising(from:string,to:string):Promise<AdvertisingFeed>{
 const account=process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON,developer=process.env.GOOGLE_ADS_DEVELOPER_TOKEN,customer=process.env.GOOGLE_ADS_CUSTOMER_ID,manager=process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,ids=process.env.GOOGLE_ADS_CAMPAIGN_IDS;
 if(!account||!developer||!customer||!ids)return unavailable('Google Ads','unconfigured');
 try{
  if(!/^\d{10}$/.test(customer)||manager&&!/^\d{10}$/.test(manager))throw Error('INVALID_ADS_ACCOUNT');
  const query=googleAdvertisingQuery(from,to,ids),credentials=JSON.parse(account);
  if(!credentials.client_email?.endsWith('.gserviceaccount.com'))throw Error('INVALID_ACCOUNT');
  const key=await importPKCS8(credentials.private_key,'RS256');
  const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/adwords'}).setProtectedHeader({alg:'RS256'}).setIssuer(credentials.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('5m').sign(key);
  const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000),cache:'no-store'});if(!auth.ok)throw Error('ADS_AUTH');
  const {access_token}=await auth.json();
  const response=await fetch(`https://googleads.googleapis.com/v25/customers/${customer}/googleAds:search`,{method:'POST',headers:{Authorization:`Bearer ${access_token}`,'developer-token':developer,...(manager?{'login-customer-id':manager}:{}),'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(15000),cache:'no-store'});if(!response.ok)throw Error('ADS_REPORT');
  const body=await response.json();if(body.nextPageToken)throw Error('ADS_REPORT_LIMIT');
  const allowed=new Set(ids.split(','));
  const rows:AdvertisingRow[]=(body.results??[]).map((r:{campaign:{id:string;name:string};segments:{date:string};customer:{currencyCode:string};metrics:{costMicros:string;impressions:string;clicks:string;conversions:number}})=>{if(!allowed.has(r.campaign.id)||r.segments.date<from||r.segments.date>to)throw Error('ADS_SCOPE');return {provider:'Google Ads',campaignId:r.campaign.id,name:r.campaign.name,date:r.segments.date,currency:r.customer.currencyCode,spend:metric(r.metrics.costMicros)/1e6,impressions:metric(r.metrics.impressions),clicks:metric(r.metrics.clicks),conversions:metric(r.metrics.conversions)};});
  return {provider:'Google Ads',status:'connected',message:'Verified STOR24 campaigns only. Provider conversions differ from CRM enquiries and leases; paused campaigns may have no activity.',rows,retrievedAt:new Date().toISOString()};
 }catch{return unavailable('Google Ads','unavailable');}
}
export async function metaAdvertising(from:string,to:string,connection?:{token:string;account:string;version:string}|null):Promise<AdvertisingFeed>{
 const token=connection?.token??process.env.META_ADS_ACCESS_TOKEN,account=connection?.account??process.env.META_ADS_ACCOUNT_ID,version=connection?.version??process.env.META_ADS_API_VERSION;
 if(!token||!account||!version)return unavailable('Meta','unconfigured');
 try{
  if(!/^\d{5,30}$/.test(account)||!/^v\d{2}\.0$/.test(version))throw Error('INVALID_META_ACCOUNT');
  const url=new URL(`https://graph.facebook.com/${version}/act_${account}/insights`);url.searchParams.set('fields','campaign_id,campaign_name,date_start,date_stop,account_currency,spend,impressions,clicks');url.searchParams.set('level','campaign');url.searchParams.set('time_increment','1');url.searchParams.set('time_range',JSON.stringify({since:from,until:to}));url.searchParams.set('limit','500');
  const rows:AdvertisingRow[]=[];let after:string|undefined;const deadline=AbortSignal.timeout(20000);
  for(let page=0;page<20;page++){
   if(after)url.searchParams.set('after',after);
   const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:deadline,cache:'no-store'});if(!res.ok)throw Error('META_REPORT');const body=await res.json();
   for(const r of body.data??[]){if(r.date_start<from||r.date_start>to)throw Error('META_SCOPE');rows.push({provider:'Meta',campaignId:String(r.campaign_id),name:r.campaign_name,date:r.date_start,currency:r.account_currency,spend:metric(r.spend),impressions:metric(r.impressions),clicks:metric(r.clicks),conversions:null});}
   if(!body.paging?.next)return {provider:'Meta',status:'connected',message:'STOR24 account campaign delivery. Meta clicks include all clicks; conversion definitions are not equated with CRM leases.',rows,retrievedAt:new Date().toISOString()};
   after=body.paging?.cursors?.after;if(!after)throw Error('META_PAGINATION');
  }throw Error('META_REPORT_LIMIT');
 }catch{return unavailable('Meta','unavailable');}
}

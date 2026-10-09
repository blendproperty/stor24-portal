import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
const rowSchema = z.object({keys:z.array(z.string()).optional(),clicks:z.number().nonnegative(),impressions:z.number().nonnegative(),ctr:z.number().min(0).max(1),position:z.number().nonnegative()});
const responseSchema=z.object({rows:z.array(rowSchema).optional()});
export type SearchPerformance = {status:"connected"|"unconfigured"|"unavailable";message:string;retrievedAt:string|null;totals:{clicks:number;impressions:number;ctr:number;position:number}|null;pages:{page:string;clicks:number;impressions:number;ctr:number;position:number}[]};
export async function marketingSearchPerformance(from:string,to:string):Promise<SearchPerformance> {
 const empty={totals:null,pages:[],retrievedAt:null};
 const credentials=process.env.GSC_SERVICE_ACCOUNT_JSON,site=process.env.GSC_SITE_URL;
 if(!credentials||!site)return {...empty,status:"unconfigured",message:"Connect the STOR24 Search Console property with read-only reporting access to see organic visibility, clicks and landing-page performance."};
 try {
  if(!/^sc-domain:[a-z0-9.-]+$/.test(site)&&!/^https:\/\/[a-z0-9.-]+\/$/.test(site))throw Error("Invalid site");
  const account=JSON.parse(credentials) as {client_email:string;private_key:string};
  if(!account.client_email?.endsWith(".gserviceaccount.com"))throw Error("Invalid account");
  const assertion=await new SignJWT({scope:"https://www.googleapis.com/auth/webmasters.readonly"}).setProtectedHeader({alg:"RS256"}).setIssuer(account.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("5m").sign(await importPKCS8(account.private_key,"RS256"));
  const auth=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}),signal:AbortSignal.timeout(10000),cache:"no-store"});
  if(!auth.ok)throw Error("Authentication unavailable");
  const token=z.object({access_token:z.string().min(1)}).parse(await auth.json()).access_token;
  async function query(dimensions:string[]) {
   const r=await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site!)}/searchAnalytics/query`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({startDate:from,endDate:to,type:"web",dataState:"final",dimensions,rowLimit:dimensions.length?10:1}),signal:AbortSignal.timeout(10000),cache:"no-store"});
   if(!r.ok)throw Error("Search reporting unavailable");return responseSchema.parse(await r.json()).rows??[];
  }
  const [totals,pages]=await Promise.all([query([]),query(["page"])]);
  return {status:"connected",message:"Google organic search · finalised data · property-wide. Search Console dates use Pacific time and recent days may be delayed. Top pages are not a complete export.",retrievedAt:new Date().toISOString(),totals:totals[0]??{clicks:0,impressions:0,ctr:0,position:0},pages:pages.map(row=>({page:row.keys?.[0]??"Unknown page",clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position}))};
 } catch { return {...empty,status:"unavailable",message:"Search Console reporting is unavailable. Check property access and API configuration; missing data is not zero performance."}; }
}

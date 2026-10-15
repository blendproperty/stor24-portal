import { apiError } from "@/lib/api";
import { requirePermissionScope, type RequestScope } from "@/lib/scope";
import { requirePermission } from "@/lib/auth-guards";
import { historyExportSchema } from "@/lib/customer-history-policy";
import { intersectHistoryScope, releaseCustomerHistoryExport } from "@/lib/customer-history-export";
import { sameOrigin } from "@/lib/request-security";
const schema=historyExportSchema;
async function source(permission:string):Promise<RequestScope|null>{try{return await requirePermissionScope(permission);}catch(e){if(e instanceof Error&&e.message==="FORBIDDEN")return null;throw e;}}
export async function POST(request:Request,context:{params:Promise<{customerId:string}>}){
  try{
    if(!sameOrigin(request))throw new Error("FORBIDDEN");
    const exported=await requirePermissionScope("customer_history.export");
    const scope=intersectHistoryScope(await requirePermissionScope("operations.view"),exported);
    let raw:unknown;try{raw=await request.json();}catch{return Response.json({error:{message:"Choose PDF or CSV and valid history filters."}},{status:422});}
    const parsed=schema.safeParse(raw);if(!parsed.success)return Response.json({error:{message:"Choose PDF or CSV and valid history filters."}},{status:422});
    const {customerId}=await context.params;
    const [communications,collections]=await Promise.all([source("communications.view"),source("collections.view")]);
    // Recheck current export authority before any bytes are constructed/released.
    const current=await requirePermissionScope("customer_history.export");
    const checked=intersectHistoryScope(scope,current);
    await requirePermission("operations.view");
    return await releaseCustomerHistoryExport({scope:checked,customerId,query:parsed.data,access:{communications,collections},format:parsed.data.format,...(parsed.data.entryId?{selection:{id:parsed.data.entryId,kind:parsed.data.entryKind!}}:{})});
  }catch(error){
    if(error instanceof Error&&["HISTORY_EXPORT_LIMIT","HISTORY_EXPORT_BLOCKED","DLP_TRANSFER_BLOCKED"].includes(error.message))return Response.json({error:{message:error.message==="HISTORY_EXPORT_LIMIT"?"History is too large for one download. Narrow the filters and download again.":"Data protection blocked this download. Ask your administrator to review the customer record."}},{status:422});
    return apiError(error);
  }
}

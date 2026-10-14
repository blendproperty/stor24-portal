import {z} from "zod";
import {db} from "@/lib/db";
import {requireTenantSession,tenantRateLimit} from "@/lib/tenant-portal-auth";
import {tenantCustomerScope} from "@/lib/tenant-portal-security";
import {tenantError,tenantPrivateHeaders} from "@/lib/tenant-portal-response";
import {listAccountPaymentRequests} from "@/lib/payments/netcash-payment-request-service";
export async function GET(request:Request){try{
 const session=await requireTenantSession();const params=new URL(request.url).searchParams;
 if(params.getAll("accountId").length!==1)throw Error("TENANT_NOT_FOUND");
 const input=z.object({accountId:z.string().cuid()}).strict().parse(Object.fromEntries(params));
 if(await tenantRateLimit(`tenant:payment-request-history:${session.tokenHash}`,30,60000))return Response.json({error:"Please wait a minute before checking again."},{status:429,headers:tenantPrivateHeaders});
 const account=await db.account.findFirst({where:{id:input.accountId,customer:tenantCustomerScope(session),tenancy:{facility:{organisationId:session.organisationId}}},select:{customerId:true,tenancy:{select:{customerId:true,facilityId:true}}}});
 if(!account?.tenancy||account.customerId!==account.tenancy.customerId)throw Error("TENANT_NOT_FOUND");
 const scope={organisationId:session.organisationId,facilityIds:[account.tenancy.facilityId],unrestrictedFacilities:false};
 return Response.json({data:await listAccountPaymentRequests(scope,input.accountId)},{headers:tenantPrivateHeaders});
}catch(error){if(error instanceof z.ZodError)return Response.json({error:"Check the selected account."},{status:422,headers:tenantPrivateHeaders});if(error instanceof Error&&error.message.startsWith("PAYMENT_REQUEST_"))return Response.json({error:"This payment request needs staff review."},{status:409,headers:tenantPrivateHeaders});return tenantError(error)}}

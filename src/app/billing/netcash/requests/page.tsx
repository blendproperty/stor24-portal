import {NetcashPaymentRequests} from "@/components/netcash-payment-requests";
import {PageHeader} from "@/components/page-header";
import {requirePermission} from "@/lib/auth-guards";
import {currentRoleAccess} from "@/lib/current-role-access";
import {db} from "@/lib/db";
export const dynamic="force-dynamic";
export const metadata={title:"Netcash account payment requests"};
export default async function Page(){
 const payment=await requirePermission("payments.view"),ledger=await requirePermission("ledger.view");
 const a=payment.allowedFacilityIds,b=ledger.allowedFacilityIds,allowed=a===null?b:b===null?a:a.filter(id=>b.includes(id));
 const accounts=await db.account.findMany({where:{customer:{organisationId:payment.organisationId},tenancy:{...(allowed?{facilityId:{in:allowed}}:{})}},select:{id:true,accountNumber:true,balance:true,currency:true,customer:{select:{firstName:true,lastName:true,companyName:true}},tenancy:{select:{facilityId:true}}},orderBy:{accountNumber:"asc"},take:251});
 const manage=currentRoleAccess(payment.user.roleAssignments,"payments.manage");
 return<><PageHeader eyebrow="Payments" title="Netcash payment requests" description="Review an existing account balance and retain every returned provider payment option."/><NetcashPaymentRequests accounts={accounts.slice(0,250).map(a=>({id:a.id,accountNumber:a.accountNumber,balance:a.balance.toFixed(2),currency:a.currency,facilityId:a.tenancy!.facilityId,name:a.customer.companyName||[a.customer.firstName,a.customer.lastName].filter(Boolean).join(" ")}))} hasMore={accounts.length>250} manageFacilities={manage.allowed?manage.allowedFacilityIds:[]}/></>;
}

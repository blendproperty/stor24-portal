import {PageHeader} from '@/components/page-header';
import {NetcashRefundWorkspace} from '@/components/netcash-refund-workspace';
import {requirePermission} from '@/lib/auth-guards';
import {currentRoleAccess} from '@/lib/current-role-access';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export const metadata={title:'Netcash refund review'};
export default async function Page(){
 const auth=await requirePermission('adjustments.view');
 const stores=await db.facility.findMany({where:{organisationId:auth.organisationId,...(auth.allowedFacilityIds?{id:{in:auth.allowedFacilityIds}}:{})},select:{id:true,name:true},orderBy:{name:'asc'}});
 const allowed=(permission:string,facilityId:string)=>currentRoleAccess(auth.user.roleAssignments,permission,facilityId).allowed;
 const facilities=stores.map(store=>({...store,prepare:allowed('payments.refund_prepare',store.id),review:allowed('payments.refund_review',store.id),reserve:allowed('payments.refund_reserve',store.id),release:allowed('payments.refund_release_review',store.id),send:allowed('payments.refund_send',store.id),sendReview:allowed('payments.refund_send_review',store.id)}));
 return<><PageHeader eyebrow="Controlled refunds" title="Netcash refund review" description="Check the original card receipt and finance-approved refund, with independent review and retained reservation history."/><NetcashRefundWorkspace facilities={facilities} userId={auth.user.id} preparationEnabled={process.env.NETCASH_REFUND_PREPARATION_ENABLED==='true'} reservationEnabled={process.env.NETCASH_REFUND_RESERVATION_ENABLED==='true'} requestEnabled={process.env.NETCASH_REFUND_REQUEST_ENABLED==='true'}/></>;
}

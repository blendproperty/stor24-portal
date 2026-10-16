import {NetcashDebiCheckTemplates} from '@/components/netcash-debicheck-templates';
import {NetcashDebiCheckRequests} from '@/components/netcash-debicheck-requests';
import {NetcashDebiCheckHistory} from '@/components/netcash-debicheck-history';
import {PageHeader} from '@/components/page-header';
import {requirePermission} from '@/lib/auth-guards';
import {currentRoleAccess} from '@/lib/current-role-access';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export const metadata={title:'DebiCheck template review'};
export default async function Page(){
 const auth=await requirePermission('payments.view');
 const facilities=await db.facility.findMany({where:{organisationId:auth.organisationId,...(auth.allowedFacilityIds?{id:{in:auth.allowedFacilityIds}}:{})},select:{id:true,name:true},orderBy:{name:'asc'}});
 const manage=currentRoleAccess(auth.user.roleAssignments,'payments.manage');
 return<><PageHeader eyebrow="Payments" title="DebiCheck setup review" description="Review the provider template and tenant setup request before the separate mandate and bank-authentication steps."/><NetcashDebiCheckTemplates facilities={facilities} manageFacilities={manage.allowed?manage.allowedFacilityIds:[]}/><NetcashDebiCheckRequests facilities={facilities} manageFacilities={manage.allowed?manage.allowedFacilityIds:[]}/><NetcashDebiCheckHistory facilities={facilities}/></>;
}

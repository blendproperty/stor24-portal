import {NetcashDebiCheckTemplates} from '@/components/netcash-debicheck-templates';
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
 return<><PageHeader eyebrow="Payments" title="DebiCheck template review" description="Retain and independently review the provider's monthly bank-authentication template before preparing customer requests."/><NetcashDebiCheckTemplates facilities={facilities} manageFacilities={manage.allowed?manage.allowedFacilityIds:[]}/></>;
}

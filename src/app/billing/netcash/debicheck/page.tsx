import {NetcashDebiCheckTemplates} from '@/components/netcash-debicheck-templates';
import {NetcashDebiCheckRequests} from '@/components/netcash-debicheck-requests';
import {NetcashDebiCheckTestActions} from '@/components/netcash-debicheck-test-actions';
import {NetcashDebiCheckBankConsents} from '@/components/netcash-debicheck-bank-consents';
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
 const manage=currentRoleAccess(auth.user.roleAssignments,'payments.manage'),submit=currentRoleAccess(auth.user.roleAssignments,'payments.bank_auth_submit'),status=currentRoleAccess(auth.user.roleAssignments,'payments.bank_auth_status');
 return<><PageHeader eyebrow="Payments" title="DebiCheck setup review" description="Review the provider template and tenant setup request before the separate mandate and bank-authentication steps."/><NetcashDebiCheckTemplates facilities={facilities} manageFacilities={manage.allowed?manage.allowedFacilityIds:[]}/><NetcashDebiCheckRequests facilities={facilities} manageFacilities={manage.allowed?manage.allowedFacilityIds:[]}/><NetcashDebiCheckBankConsents facilities={facilities}/><NetcashDebiCheckTestActions facilities={facilities} submitFacilities={submit.allowed?submit.allowedFacilityIds:[]} statusFacilities={status.allowed?status.allowedFacilityIds:[]} submitEnabled={process.env.NETCASH_DEBICHECK_BANK_AUTHENTICATION_TEST_ENABLED==='true'} statusEnabled={process.env.NETCASH_DEBICHECK_STATUS_LOOKUP_ENABLED==='true'}/><NetcashDebiCheckHistory facilities={facilities}/></>;
}

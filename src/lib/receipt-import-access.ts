import type {Prisma} from '@/generated/prisma/client';
import {currentRoleAccess} from './current-role-access';
import {facilityWhere,type RequestScope} from './scope';

/** Recheck actual current assignments in the same transaction as a source
 * approval or financial post; a cached request scope cannot restore a grant. */
export async function receiptImportAuthority(client:Prisma.TransactionClient,scope:RequestScope,permissions:string[],facilityId?:string){
 const user=await client.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
 if(!user)throw Error('UNAUTHENTICATED');
 if(facilityId){
  if(!await client.facility.findFirst({where:{AND:[{id:facilityId},facilityWhere(scope)]},select:{id:true}}))throw Error('FACILITY_FORBIDDEN');
 }else if(!scope.unrestrictedFacilities)throw Error('FORBIDDEN');
 for(const permission of permissions){
  const access=currentRoleAccess(user.roleAssignments.filter(a=>a.role.organisationId===scope.organisationId),permission,facilityId);
  if(!access.allowed||!facilityId&&access.allowedFacilityIds!==null)throw Error('FORBIDDEN');
 }
 return user;
}

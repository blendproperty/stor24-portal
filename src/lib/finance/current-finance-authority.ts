import type {Prisma} from '@/generated/prisma/client';
import type {RequestScope} from '@/lib/scope';
import {currentRoleAccess} from '@/lib/current-role-access';

/** RequestScope limits the original request; it is not permission to execute
 * a later attempt. Read current actor/role/store authority in the transaction
 * that will write, including every attempt after a confirmed rollback. */
export async function requireCurrentFinanceAuthority(tx:Prisma.TransactionClient,scope:RequestScope,permissions:string[],facilityId:string){
 if(!facilityId||!permissions.length||!scope.unrestrictedFacilities&&!scope.facilityIds.includes(facilityId))throw Error('FORBIDDEN');
 const user=await tx.user.findFirst({where:{id:scope.userId,organisationId:scope.organisationId,active:true},include:{roleAssignments:{include:{role:true}}}});
 if(!user||!permissions.every(permission=>currentRoleAccess(user.roleAssignments,permission,facilityId).allowed))throw Error('FORBIDDEN');
}

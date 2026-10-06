import type {Prisma} from "@/generated/prisma/client";
/** Same lock order as booking/combination: facility, then unit. */
export async function requireEditableCombinationUnit(tx:Prisma.TransactionClient,facilityId:string,id:string){
 await tx.$queryRaw`SELECT "id" FROM "Facility" WHERE "id"=${facilityId} FOR UPDATE`;
 await tx.$queryRaw`SELECT "id" FROM "Unit" WHERE "id"=${id} AND "facilityId"=${facilityId} FOR UPDATE`;
 const unit=await tx.unit.findFirst({where:{id,facilityId},select:{combinedIntoUnitId:true,combinationSnapshot:true}});
 if(!unit||unit.combinedIntoUnitId||unit.combinationSnapshot)throw new Error("CONFLICT");
}

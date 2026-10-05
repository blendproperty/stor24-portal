import { requireOwner } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { RentReviewWorkspace } from '@/components/rent-review-workspace';
export const dynamic='force-dynamic';
export const metadata={title:'Rent reviews & tenant duration'};
export default async function RentReviewsPage(){const auth=await requireOwner();const facilities=await db.facility.findMany({where:{organisationId:auth.user.organisationId},select:{id:true,name:true},orderBy:{name:'asc'}});return <RentReviewWorkspace facilities={facilities}/>;}

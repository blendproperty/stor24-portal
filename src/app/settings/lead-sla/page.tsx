import {requireOwner} from '@/lib/auth-guards';
import {db} from '@/lib/db';
import {LeadSlaWorkspace} from '@/components/lead-sla-workspace';
export const dynamic='force-dynamic';
export const metadata={title:'Enquiry response SLA'};
export default async function LeadSlaPage(){const a=await requireOwner();return <LeadSlaWorkspace facilities={await db.facility.findMany({where:{organisationId:a.user.organisationId},select:{id:true,name:true},orderBy:{name:'asc'}})}/>;}

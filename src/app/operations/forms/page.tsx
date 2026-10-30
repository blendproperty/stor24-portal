import { PageHeader } from "@/components/page-header";
import { OperationalFormsWorkspace } from "@/components/operational-forms-workspace";
import {requirePermissionScope,facilityWhere} from "@/lib/scope";
import {db} from "@/lib/db";
import {notFound} from "next/navigation";
import {z} from "zod";
import "@/styles/operational-forms.css";
export const metadata={title:"Maintenance and visitor forms"};
export default async function OperationalFormsPage({searchParams}:{searchParams:Promise<{maintenanceId?:string}>}){const scope=await requirePermissionScope("operations.view"),{maintenanceId}=await searchParams;let facilityId="";if(maintenanceId){if(!z.cuid().safeParse(maintenanceId).success)notFound();const record=await db.maintenanceRequest.findFirst({where:{id:maintenanceId,organisationId:scope.organisationId,facility:facilityWhere(scope)},select:{facilityId:true}});if(!record)notFound();facilityId=record.facilityId;}return <div className="page-stack"><PageHeader eyebrow="Facility operations" title="Maintenance and visitor forms" description="Structured maintenance evidence, certificate review tasks and staff-assisted visitor or client attendance records."/><OperationalFormsWorkspace initialFacilityId={facilityId} initialMaintenanceId={maintenanceId??""}/></div>;}

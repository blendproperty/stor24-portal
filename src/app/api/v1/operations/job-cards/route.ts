import { authErrorResponse, requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { MIDPOINT_JOB_CARD_ROLE, validMidpointJobCardRole } from "@/lib/maintenance-job-policy";

export async function GET() {
  try {
    const { user } = await requireSession();
    const allowed = user.roleAssignments.filter(assignment =>
      assignment.role.name === MIDPOINT_JOB_CARD_ROLE &&
      validMidpointJobCardRole(user.email, assignment.role.permissions, assignment.facility));
    if (allowed.length !== 1 || !allowed[0].facilityId) throw new Error("FORBIDDEN");
    const data = await db.maintenanceRequest.findMany({
      where: { organisationId: user.organisationId, facilityId: allowed[0].facilityId, jobCard: true },
      select: {
        id: true, title: true, description: true, priority: true, status: true, updatedAt: true,
        dueAt: true, contractor: true, scheduledFor: true, progressNotes: true, completionEvidence: true,
        repairReportedAt: true, verificationNote: true, unit: { select: { number: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100,
    });
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

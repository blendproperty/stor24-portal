import { z } from "zod";
import { db } from "./db";
import { CHECKLIST_PURPOSE, checklistRecordSchema, templateKeySchema } from "./operational-checklist-policy";
import { facilityWhere, type RequestScope } from "./scope";
import { southAfricaDateKey } from "./south-africa-time";

export const checklistReportTemplates = templateKeySchema.exclude(["PADLOCK"]);
export const checklistReportFilters = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  facility: z.union([z.cuid(), z.literal("")]),
  template: z.union([checklistReportTemplates, z.literal("")]),
}).refine(({ from, to }) => {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return days >= 0 && days < 92;
});

export async function checklistReport(scope: RequestScope, filters: z.infer<typeof checklistReportFilters>) {
  const { from, to, facility, template } = checklistReportFilters.parse(filters);
  const start = new Date(`${from}T00:00:00+02:00`);
  const end = new Date(`${to}T00:00:00+02:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const limit = 500;
  const tasks = await db.task.findMany({
    where: {
      organisationId: scope.organisationId,
      facility: { AND: [facilityWhere(scope), ...(facility ? [{ id: facility }] : [])] },
      purpose: CHECKLIST_PURPOSE,
      startAt: { gte: start, lt: end },
      OR: (template ? [template] : checklistReportTemplates.options).map(value => ({
        operationalChecklist: { path: ["template"], equals: value },
      })),
    },
    orderBy: [{ startAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true, status: true, startAt: true, dueAt: true, operationalChecklist: true,
      facility: { select: { name: true } }, assignee: { select: { name: true } },
    },
  });
  if (tasks.length > limit) return { overLimit: true as const };

  const runs = tasks.map(({ operationalChecklist, ...task }) => {
    const record = checklistRecordSchema.parse(operationalChecklist);
    const saved = record.rows.filter(row => row.state !== "PENDING");
    return {
      ...task,
      date: southAfricaDateKey(task.startAt!),
      record,
      saved,
      issues: saved.filter(row => row.state === "ISSUE").length,
      notApplicable: saved.filter(row => row.state === "NA").length,
    };
  });
  return { overLimit: false as const, runs };
}

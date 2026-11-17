import { checklistRecordSchema } from "./operational-checklist-policy";
import { formRecordSchema } from "./operational-form-policy";

export function canRetainTaskData(task: { purpose: string; status: string; operationalForm: unknown; operationalChecklist: unknown; unexpectedReference?: boolean }, userId: string) {
  if (task.unexpectedReference) return false;
  const closed = ["COMPLETED", "CANCELLED"].includes(task.status);
  if (task.purpose === "OPERATIONAL_CHECKLIST" && task.operationalForm === null) {
    const parsed = checklistRecordSchema.safeParse(task.operationalChecklist);
    if (!parsed.success || (!closed && parsed.data.reviewerId === userId) || [parsed.data.reviewerId, parsed.data.submittedBy, parsed.data.reviewedBy].some(value => value && value !== userId && value.includes(userId))) return false;
    return !JSON.stringify({ ...parsed.data, reviewerId: null, submittedBy: null, reviewedBy: null }).includes(userId);
  }
  if (task.purpose === "OPERATIONAL_FORM" && task.operationalChecklist === null) {
    const parsed = formRecordSchema.safeParse(task.operationalForm);
    if (!parsed.success || (!closed && parsed.data.reviewerId === userId) || [parsed.data.reviewerId, parsed.data.reviewedBy].some(value => value && value !== userId && value.includes(userId))) return false;
    return !JSON.stringify({ ...parsed.data, reviewerId: null, reviewedBy: null }).includes(userId);
  }
  return false;
}

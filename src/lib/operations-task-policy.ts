import { z } from "zod";

const statuses = ["OPEN", "IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"] as const;
export const operationsTaskFiltersSchema = z.object({
  assignee: z.union([z.enum(["all", "mine", "unassigned", "search"]), z.string().cuid()]).default("all"),
  person: z.string().trim().max(100).default(""),
  facility: z.union([z.enum(["all", "portfolio"]), z.string().cuid()]).default("all"),
  status: z.enum(["active", "all", ...statuses]).default("active"),
  due: z.enum(["all", "overdue", "today", "upcoming", "undated"]).default("all"),
  q: z.string().trim().max(100).default(""),
}).strict().superRefine((value, context) => {
  if (value.assignee === "search" ? value.person.length < 2 : !!value.person) context.addIssue({ code: "custom", message: "Choose an assigned person or enter at least two characters to find one." });
});
export const operationsTaskQuerySchema = operationsTaskFiltersSchema.safeExtend({ cursor: z.string().cuid().optional() });
export type OperationsTaskFilters = z.infer<typeof operationsTaskFiltersSchema>;
const named = z.object({ id: z.string(), name: z.string() });
export const operationsTaskPageSchema = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string(), description: z.string().nullable(), customerId: z.string().nullable(), purpose: z.string(), status: z.enum(statuses), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]), dueAt: z.iso.datetime().nullable(), facility: named.nullable(), assignee: named.nullable() })).max(25),
  total: z.number().int().nonnegative(), nextCursor: z.string().nullable(), asOf: z.iso.datetime(), userId: z.string(), unrestrictedFacilities: z.boolean(),
  filters: operationsTaskFiltersSchema, facilities: z.array(named), assignees: z.array(named).max(200), assigneesComplete: z.boolean(),
}).strict();
export type OperationsTaskPage = z.infer<typeof operationsTaskPageSchema>;

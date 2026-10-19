import { followupDayEnd } from "./staff-followup-policy";

// Read the saved date directly so rescheduling cannot leave a duplicate task behind.
export function leadFollowupWhere(now = new Date()) {
  return { stage: { notIn: ["WON", "LOST"] as ("WON" | "LOST")[] }, nextActionAt: { lt: followupDayEnd(now) },
    reservations: { none: { status: "CONVERTED" as const, convertedTenancy: { status: { in: ["ACTIVE", "NOTICE_GIVEN"] as ("ACTIVE" | "NOTICE_GIVEN")[] } } } } };
}

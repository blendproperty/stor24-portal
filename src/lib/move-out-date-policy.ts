import { southAfricaDateKey } from "@/lib/south-africa-time";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MOVE_OUT_POLICY_REVIEW");
  return value as Record<string, unknown>;
}

/** Enforce explicitly saved date restrictions; this does not calculate fees or proration. */
export function assertMoveOutDatePolicy(config: unknown, movedOutAt: Date, now = new Date()) {
  if (!Number.isFinite(movedOutAt.getTime()) || !Number.isFinite(now.getTime())) throw new Error("MOVE_OUT_DATE_RESTRICTED");
  if (config == null) return;
  const defaults = record(config).defaults;
  if (defaults === undefined) return;
  const group = record(defaults)["Move Out"];
  if (group === undefined) return;
  const settings = record(group);
  const mode = settings.moveOutDate;
  if (mode != null && mode !== "" && (typeof mode !== "string" || !["today", "todayFuture", "todayPast", "any"].includes(mode))) throw new Error("MOVE_OUT_POLICY_REVIEW");
  const maximum = settings.maxBackdatingDays;
  if (maximum != null && maximum !== "" && (typeof maximum !== "number" || !Number.isSafeInteger(maximum) || maximum < 0)) throw new Error("MOVE_OUT_POLICY_REVIEW");
  const currentMonth = settings.restrictCurrentMonth;
  if (currentMonth != null && typeof currentMonth !== "boolean") throw new Error("MOVE_OUT_POLICY_REVIEW");
  const date = southAfricaDateKey(movedOutAt), today = southAfricaDateKey(now);
  if ((mode === "today" && date !== today) || (mode === "todayFuture" && date < today) || (mode === "todayPast" && date > today)) throw new Error("MOVE_OUT_DATE_RESTRICTED");
  if (date < today) {
    const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
    if ((typeof maximum === "number" && maximum > 0 && days > maximum) || (currentMonth === true && date.slice(0, 7) !== today.slice(0, 7))) throw new Error("MOVE_OUT_DATE_RESTRICTED");
  }
}

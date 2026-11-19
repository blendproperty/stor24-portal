import { southAfricaDateKey } from "@/lib/south-africa-time";

/** Lockouts run after closing and only for a staff-cleared night. */
export function hikCentralOvernightWindow(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour >= 7 && hour < 19) return null;
  const date = southAfricaDateKey(hour < 7 ? new Date(now.getTime() - 7 * 60 * 60_000) : now);
  const start = new Date(`${date}T19:00:00+02:00`);
  return { start, end: new Date(start.getTime() + 12 * 60 * 60_000), date };
}

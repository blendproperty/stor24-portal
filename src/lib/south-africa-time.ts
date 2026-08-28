export const SOUTH_AFRICA_TIME_ZONE = "Africa/Johannesburg";

export function formatSouthAfricaDateTime(value: string | Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: SOUTH_AFRICA_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(value));
}

export function southAfricaDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SOUTH_AFRICA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

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

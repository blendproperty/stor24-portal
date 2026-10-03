export const LEAD_SOURCES = ["Walk-in", "Phone in", "Website", "Google Ad", "Google Search", "Google Maps", "WhatsApp", "SMS", "Email", "Facebook", "Facebook Ad", "Facebook Marketplace", "Instagram", "Instagram Ad", "TikTok", "LinkedIn", "Customer referral", "Friend / family referral", "Estate agent / property manager", "Removal / moving company", "Business partner", "Roadside signage", "Billboard", "Flyer / brochure", "Print advertising", "Radio", "Event / exhibition", "Online directory", "Gumtree", "Vehicle branding", "Community sponsorship", "Returning customer", "Other"] as const;
export function leadSourceLabel(source: string) {
  return ({ Phone: "Phone in", Walkin: "Walk-in", "Phone In": "Phone in", PUBLIC_QUOTE_FORM: "Website", PUBLIC_BOOKING: "Website" } as Record<string, string>)[source] ?? source;
}

export function websiteSourceLabel(attribution: {source: string; medium?: string}) {
  if(attribution.source === "google" && attribution.medium === "cpc") return "Google Ad";
  if(attribution.source === "google" && attribution.medium === "organic") return "Google Search";
  if(attribution.source === "google" && attribution.medium === "display") return "Google Display Ad";
  return [attribution.source, attribution.medium].filter(Boolean).join(" / ");
}

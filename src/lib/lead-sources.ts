export const LEAD_SOURCES = ["Walk-in", "Phone in", "Website", "WhatsApp", "SMS", "Email", "Customer referral", "Friend / family referral", "Estate agent / property manager", "Removal / moving company", "Business partner", "Roadside signage", "Billboard", "Flyer / brochure", "Print advertising", "Radio", "Event / exhibition", "Online directory", "Gumtree", "Vehicle branding", "Community sponsorship", "Returning customer", "Other"] as const;
export function leadSourceLabel(source: string) {
  return ({ Phone: "Phone in", Walkin: "Walk-in", "Phone In": "Phone in", PUBLIC_QUOTE_FORM: "Website", PUBLIC_BOOKING: "Website" } as Record<string, string>)[source] ?? source;
}

export function websiteSourceLabel(attribution: {source: string; medium?: string}) {
  const platform = ({google: "Google", bing: "Bing", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", x: "X", pinterest: "Pinterest", newsletter: "Newsletter", direct: "Direct", other: "Other"} as Record<string, string>)[attribution.source] ?? "Other";
  if (["cpc", "paid_social", "display"].includes(attribution.medium ?? "")) return `${platform}${attribution.medium === "display" ? " Display" : ""} Ad`;
  if (attribution.medium === "organic") return `${platform} Search`;
  if (attribution.medium === "social") return `${platform} Social`;
  return [platform, attribution.medium === "direct" ? undefined : attribution.medium].filter(Boolean).join(" / ");
}

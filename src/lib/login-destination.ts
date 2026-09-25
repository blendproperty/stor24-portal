/** Keep post-authentication navigation local, including after URL normalization. */
export function loginDestination(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\") || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return "/";
  try {
    const base = "https://stor24.invalid";
    const destination = new URL(value, base);
    if (destination.origin !== base || destination.pathname.startsWith("//")) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch { return "/"; }
}

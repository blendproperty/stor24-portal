/** An editable suggestion only; the normal emailed-code authentication is still required. */
export function tenantLoginHint(hash: string): string | undefined {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("email");
  if (!value || value.length > 254 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return;
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

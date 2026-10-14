/** Card vault tokens and cardholder/card/IP details are not needed by the
 * provider-hosted subscription contract. Drop them before inbox persistence.
 */
export function netcashNotifyProjection(raw: string) {
  const form = new URLSearchParams(raw);
  const allowed = new Set(["Reference", "RequestTrace", "Amount", "Method", "TransactionAccepted"]);
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  if ([...form.keys()].length > 40) throw Error("NETCASH_NOTIFY_INVALID");
  for (const [name, value] of form) {
    if (seen.has(name)) throw Error("NETCASH_NOTIFY_INVALID");
    seen.add(name);
    if (!allowed.has(name)) continue;
    if (value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw Error("NETCASH_NOTIFY_INVALID");
    result[name] = value;
  }
  return result;
}

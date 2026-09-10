export type TenantAccount = { id: string; accountNumber: string; balance: string; currency: string; tenancy: null | { status: string; facility: { name: string }; occupancies: { unit: { number: string } }[] } };

export function preferredTenantAccount(accounts: TenantAccount[], requested?: string) {
  return accounts.find(account => account.id === requested)?.id
    ?? accounts.find(account => account.tenancy?.status === "ACTIVE")?.id
    ?? accounts.find(account => account.tenancy)?.id
    ?? accounts[0]?.id ?? "";
}

export function tenantAccountLabel(account: TenantAccount) {
  if (account.tenancy) return `${account.tenancy.facility.name} · Unit ${account.tenancy.occupancies[0]?.unit.number ?? "not assigned"}`;
  return "Account without an assigned unit";
}

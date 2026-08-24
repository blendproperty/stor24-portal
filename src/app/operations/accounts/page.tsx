import { AccountsWorkspace } from "@/components/accounts-workspace";

export const metadata = { title: "Accounts" };
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ accountId?: string; documentId?: string }> }) {
  const { accountId, documentId } = await searchParams;
  return <AccountsWorkspace initialAccountId={accountId} initialDocumentId={documentId}/>;
}

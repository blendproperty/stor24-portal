import { AccountsWorkspace } from "@/components/accounts-workspace";

export const metadata = { title: "Accounts" };
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ documentId?: string }> }) {
  const { documentId } = await searchParams;
  return <AccountsWorkspace initialDocumentId={documentId}/>;
}

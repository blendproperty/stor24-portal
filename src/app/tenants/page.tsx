import { CustomerOperationsWorkspace } from "@/components/customer-operations-workspace";

export const metadata = { title: "Customers & tenants" };
export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) { const params = await searchParams; return <CustomerOperationsWorkspace initialCustomerId={params.customer}/>; }

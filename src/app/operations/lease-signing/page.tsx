import { requireSession } from "@/lib/auth-guards";
import { LeaseSigningSession } from "@/components/lease-signing-session";

export const metadata = { title: "Review and sign lease", referrer: "no-referrer" };
export default async function LeaseSigningPage({ searchParams }: { searchParams: Promise<{ document?: string }> }) {
  await requireSession();
  const { document } = await searchParams;
  return <LeaseSigningSession documentId={document ?? ""} />;
}

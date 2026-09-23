import { IdentityReview } from "@/components/identity-review";
import { requirePermissionScope } from "@/lib/scope";
import { identityPolicy } from "@/lib/identity-document-security";
export const metadata = { title: "Identity review" };
export const dynamic = "force-dynamic";
export default async function IdentityPage({ searchParams }: { searchParams: Promise<{ reservation?: string }> }) {
  const { reservation } = await searchParams;
  const scope = await requirePermissionScope("identity.review");
  let enabled = false;
  try { enabled = Boolean(identityPolicy(scope.organisationId)); } catch { /* An invalid policy also holds collection. */ }
  return <IdentityReview key={reservation ?? "queue"} enabled={enabled} reservationId={reservation} />;
}

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { PortalAuthLayout } from "@/components/portal-auth-layout";
import { MfaSettings } from "@/components/mfa-settings";

export const metadata = { title: "Required two-step verification" };
export default async function MfaSetupPage() {
  const auth = await requireSession({ allowMfaSetup: true });
  const credential = await db.mfaCredential.findUnique({ where: { userId: auth.user.id }, select: { enabledAt: true } });
  if (credential?.enabledAt && auth.mfaVerified !== true) redirect("/login");
  return <PortalAuthLayout eyebrow="Required account security" title="Set up two-step verification" description="Every STOR24 staff member must use an authenticator app. Scan the QR code, verify a code and save your recovery codes before continuing."><MfaSettings enrollment /></PortalAuthLayout>;
}

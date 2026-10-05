import { requireOwner } from '@/lib/auth-guards';
import { TroubleshootingDashboard } from '@/components/troubleshooting-dashboard';
export const metadata = { title: 'Troubleshooting' };
export const dynamic = 'force-dynamic';
export default async function TroubleshootingPage() {
  const auth = await requireOwner();
  if (!process.env.STOR24_ALERT_ORGANISATION_ID || process.env.STOR24_ALERT_ORGANISATION_ID !== auth.user.organisationId) throw new Error('FORBIDDEN');
  return <TroubleshootingDashboard />;
}

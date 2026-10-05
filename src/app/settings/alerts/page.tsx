import { requireOwner } from '@/lib/auth-guards';
import { OperationsAlertRecipients } from '@/components/operations-alert-recipients';

export const metadata = { title: 'Operations alerts' };
export const dynamic = 'force-dynamic';
export default async function OperationsAlertsPage() {
  const auth = await requireOwner();
  if (process.env.STOR24_ALERT_ORGANISATION_ID && process.env.STOR24_ALERT_ORGANISATION_ID !== auth.user.organisationId) throw Error('FORBIDDEN');
  return <OperationsAlertRecipients />;
}

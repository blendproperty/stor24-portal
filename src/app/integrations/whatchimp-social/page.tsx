import { SocialProvisionForm } from '@/components/social-provision-form';
import { requireOwner } from '@/lib/auth-guards';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Social enquiry connection' };
export default async function SocialConnectionPage() {
  await requireOwner();
  return <main className="page-stack"><h1>Facebook and Instagram enquiries</h1><SocialProvisionForm /></main>;
}

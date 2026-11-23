import { SocialProvisionForm } from '@/components/social-provision-form';
import { requireOwner } from '@/lib/auth-guards';
import { WhatChimpRecipientForm } from '@/components/whatchimp-recipient-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messaging enquiries' };
export default async function SocialConnectionPage() {
  await requireOwner();
  return <main className="page-stack"><h1>Messaging enquiries</h1><h2>Facebook and Instagram</h2><SocialProvisionForm /><WhatChimpRecipientForm /></main>;
}

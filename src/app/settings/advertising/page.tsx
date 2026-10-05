import {requireOwner} from '@/lib/auth-guards';
import {AdvertisingConnectionForm} from '@/components/advertising-connection-form';
export const metadata={title:'Advertising reporting'};
export default async function AdvertisingSettings(){await requireOwner();return <AdvertisingConnectionForm/>;}

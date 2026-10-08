import {requireOwner} from '@/lib/auth-guards';
import {AdvertisingConnectionForm} from '@/components/advertising-connection-form';
import {GoogleAnalyticsSetup,GoogleSearchConsoleSetup} from '@/components/google-analytics-setup';
import {notFound} from 'next/navigation';
export const metadata={title:'Advertising reporting'};
export default async function AdvertisingSettings(){const owner=await requireOwner();if(owner.user.organisationId!==process.env.ADVERTISING_ORGANISATION_ID)notFound();let project='',reader='';try{const account=JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON??'{}');if(typeof account.project_id==='string'&&/^[a-z][a-z0-9-]{4,60}$/.test(account.project_id))project=account.project_id;if(typeof account.client_email==='string'&&/^[a-zA-Z0-9._-]+@[a-zA-Z0-9-]+\.iam\.gserviceaccount\.com$/.test(account.client_email))reader=account.client_email;}catch{}return <><AdvertisingConnectionForm/><GoogleAnalyticsSetup project={project} reader={reader}/><GoogleSearchConsoleSetup/></>}

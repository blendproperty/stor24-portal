import {PageHeader} from '@/components/page-header';
import {ReceiptBankSourceWorkspace} from '@/components/receipt-bank-source-workspace';
import {requirePermissionScope} from '@/lib/scope';
export const metadata={title:'Incoming bank sources'};
export default async function ReceiptBankSourcesPage(){
 await requirePermissionScope('receipt_review.bank_sources');await requirePermissionScope('settlements.view');
 return <div className="page-stack"><PageHeader eyebrow="Finance review" title="Incoming bank sources" description="Retain the incoming account identity and obtain an independent finance review before using bank evidence for receipts."/><ReceiptBankSourceWorkspace/></div>;
}

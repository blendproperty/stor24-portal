import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {db} from '../../src/lib/db';
import {createReceiptBankSource,reviewReceiptBankSource,receiptBankSourcePrivateDetails,approvedReceiptBankSource,receiptBankSourceWorkspace} from '../../src/lib/receipt-bank-source-service';
import {captureUnidentifiedReceipt,actOnUnidentifiedReceipt,unidentifiedReceiptSources} from '../../src/lib/unidentified-receipt-service';
import {previewImportedReceiptPosting,postImportedReceipt,importedReceiptPostingEvidence} from '../../src/lib/receipt-import-service';
import {settlementAction,previewStatement,settlementDetail,settlementBankSourceOptions} from '../../src/lib/settlement-service';
import {encryptIntegrationSecret} from '../../src/lib/integrations/integration-secret-vault';
import {previewReceiptReallocation,requestReceiptReallocation,decideReceiptReallocation} from '../../src/lib/receipt-reallocation-service';
import {previewAdjustment,requestAdjustment,decideAdjustment} from '../../src/lib/adjustment-service';
import {importedReceiptDocument} from '../../src/lib/receipt-import-service';
import {receiptAllocationGraph} from '../../src/lib/receipt-reallocation-source';

test('isolated native receipt imports preserve independent approvals, original cash and atomic once-only posting',async t=>{
 assert.equal(process.env.MERCHANDISE_DB_TEST,'isolated-ci');const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'localhost');assert.match(url.pathname,/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/);
 const oldSigning=process.env.AUTH_SECRET,oldVault=process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY,originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Provider/network calls are forbidden in the isolated receipt fixture');};
 process.env.AUTH_SECRET=randomBytes(32).toString('hex');process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
 const org=await db.organisation.create({data:{name:'Synthetic incoming receipt fixture',slug:randomUUID()}});
 const facility=await db.facility.create({data:{organisationId:org.id,name:'Synthetic receipt facility',code:randomUUID()}});
 const permissions=['adjustments.view','adjustments.request','adjustments.approve','adjustments.record_refund','receipt_review.view','receipt_review.capture','receipt_review.propose','receipt_review.approve','receipt_review.post','receipt_review.bank_sources','settlements.view','settlements.import','payments.manage','ledger.view','billing.view'];
 async function actor(name:string){const user=await db.user.create({data:{organisationId:org.id,name,email:randomUUID()+'@example.invalid'}}),role=await db.role.create({data:{organisationId:org.id,name,permissions}});await db.roleAssignment.create({data:{userId:user.id,roleId:role.id}});return{role,user,scope:{organisationId:org.id,userId:user.id,facilityIds:[],unrestrictedFacilities:true}};}
 const maker=await actor('Synthetic source maker'),reviewer=await actor('Synthetic independent reviewer');
 async function account(){const customer=await db.customer.create({data:{organisationId:org.id,firstName:'Synthetic receipt customer'}}),account=await db.account.create({data:{customerId:customer.id,accountNumber:randomUUID(),balance:200}});await db.tenancy.create({data:{customerId:customer.id,accountId:account.id,facilityId:facility.id,startDate:new Date('2026-01-01'),status:'ACTIVE'}});await db.ledgerEntry.create({data:{accountId:account.id,type:'CHARGE',amount:200,description:'Synthetic original charge',effectiveAt:new Date('2026-01-01')}});return account;}
 const sourceInput={bankCode:'ABCDZAJJ',accountNumber:'000123456789',label:'Synthetic incoming source',requestKey:randomUUID(),reference:'Synthetic original bank evidence',confirmed:true};
 let bankSourceId='';
 const reviewBank=(id:string,revision:number,action='approve')=>({id,revision,action,reference:'Synthetic independent bank review',confirmed:true});
 async function bankImport(mapped=true,currency=true,transactionId=randomUUID()){
  const raw=`transaction_id,date,amount,reference${currency?',currency':''}\n${transactionId},2026-10-14,100.25,Synthetic incoming receipt${currency?',ZAR':''}\n`;
  const result=await settlementAction(maker.scope,{action:'bank-import',...(mapped?{bankSourceId}:{}),alias:'Synthetic bank alias '+randomUUID(),environment:'live',raw,sourceReference:'Synthetic retained bank evidence',confirm:true});
  assert.ok('id'in result&&typeof result.id==='string');const saved=await db.settlementBankImport.findUniqueOrThrow({where:{id:result.id},include:{entries:true}});return{saved,raw};
 }
 async function reviewedSource(type:'BANK_IMPORT_ENTRY'|'NETCASH_STATEMENT_LINE',sourceId:string,target=undefined as Awaited<ReturnType<typeof account>>|undefined){
  const accountRow=target??await account(),source=(await unidentifiedReceiptSources(maker.scope)).rows.find(r=>r.sourceId===sourceId);assert.ok(source);
  const intake=await captureUnidentifiedReceipt(maker.scope,{facilityId:facility.id,requestKey:randomUUID(),source:{sourceType:type,sourceId,sourceFingerprint:source.sourceFingerprint}});
  await actOnUnidentifiedReceipt(maker.scope,{action:'propose',id:intake.id,facilityId:facility.id,revision:0,accountId:accountRow.id,reason:'Synthetic exact original source and customer account match',confirmed:true});
  const proposal=await db.unidentifiedReceiptMatchProposal.findFirstOrThrow({where:{intakeId:intake.id}});
  await actOnUnidentifiedReceipt(reviewer.scope,{action:'review',id:intake.id,facilityId:facility.id,revision:1,proposalId:proposal.id,decision:'REVIEWED',reference:'Synthetic independent matching review',confirmed:true});
  const input={intakeId:intake.id,proposalId:proposal.id,facilityId:facility.id,approvalReference:'Synthetic receipt approval and duplicate investigation',originalStatementConfirmed:true,customerReceiptConfirmed:true,noPriorReceiptConfirmed:true};
  return{account:accountRow,intake,proposal,input};
 }
 async function counts(){return JSON.stringify(await Promise.all([db.payment.count({where:{account:{customer:{organisationId:org.id}}}}),db.ledgerEntry.count({where:{account:{customer:{organisationId:org.id}}}}),db.document.count({where:{tenancy:{facilityId:facility.id}}}),db.receiptImportPosting.count({where:{organisationId:org.id}}),db.account.findMany({where:{customer:{organisationId:org.id}},orderBy:{id:'asc'},select:{id:true,balance:true,updatedAt:true}})]));}
 try{
  await t.test('maker cannot self-approve; approved physical identity cannot be recreated by aliases or zero padding',async()=>{
   const requested=await createReceiptBankSource(maker.scope,sourceInput);bankSourceId=requested.id;
   assert.equal((await createReceiptBankSource(maker.scope,sourceInput)).id,requested.id);
   await assert.rejects(reviewReceiptBankSource(maker.scope,reviewBank(requested.id,0)),/INDEPENDENT/);
   await assert.rejects(db.$transaction(tx=>approvedReceiptBankSource(tx,org.id,requested.id)),/APPROVAL_REQUIRED/);
   const details=await receiptBankSourcePrivateDetails(reviewer.scope,requested.id);assert.equal(details.bank.accountNumber,sourceInput.accountNumber);
   await reviewReceiptBankSource(reviewer.scope,reviewBank(requested.id,0));
   await assert.rejects(createReceiptBankSource(maker.scope,{...sourceInput,accountNumber:'123456789',label:'Another alias',requestKey:randomUUID()}),/EXISTS/);
   assert.equal(requested.providerVerified,false);assert.ok((await db.$transaction(tx=>approvedReceiptBankSource(tx,org.id,requested.id))).approvalAuditId);
  });
  await t.test('normal mapped import uses stable bank root and requires original source currency plus current import access',async()=>{
   await assert.rejects(bankImport(true,false),/CURRENCY/);
   const transactionId=randomUUID(),first=await bankImport(true,true,transactionId),second=await bankImport(true,true,transactionId);
   assert.equal(first.saved.id,second.saved.id);assert.equal(first.saved.receiptBankSourceId,bankSourceId);
   await db.role.update({where:{id:maker.role.id},data:{permissions:permissions.filter(p=>p!=='settlements.import')}});
   await assert.rejects(bankImport(),/FORBIDDEN/);
   await db.role.update({where:{id:maker.role.id},data:{permissions}});
  });
  await t.test('unmapped evidence cannot post and preview requires independent actor and every finance attestation',async()=>{
   const imported=await bankImport(false,true),c=await reviewedSource('BANK_IMPORT_ENTRY',imported.saved.entries[0].id),before=await counts();
   await assert.rejects(previewImportedReceiptPosting(reviewer.scope,c.input),/BANK_MAPPING/);
   const mapped=await bankImport(),m=await reviewedSource('BANK_IMPORT_ENTRY',mapped.saved.entries[0].id);
   await assert.rejects(previewImportedReceiptPosting(maker.scope,m.input),/INDEPENDENT/);
   for(const flag of ['originalStatementConfirmed','customerReceiptConfirmed','noPriorReceiptConfirmed'])await assert.rejects(previewImportedReceiptPosting(reviewer.scope,{...m.input,[flag]:false}));
   assert.equal(await db.receiptImportPosting.count({where:{organisationId:org.id}}),0);assert.ok(before);
  });
  await t.test('stale account, source changes and revoked current permission block a signed preview without financial effects',async()=>{
   const imported=await bankImport(),c=await reviewedSource('BANK_IMPORT_ENTRY',imported.saved.entries[0].id),preview=await previewImportedReceiptPosting(reviewer.scope,c.input),before=await counts();
   await db.role.update({where:{id:reviewer.role.id},data:{permissions:permissions.filter(p=>p!=='receipt_review.post')}});
   await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()),/FORBIDDEN/);
   await db.role.update({where:{id:reviewer.role.id},data:{permissions}});
   await db.settlementBankEntry.update({where:{id:imported.saved.entries[0].id},data:{reference:'Synthetic changed source'}});
   await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()),/SOURCE_INTEGRITY/);
   await db.settlementBankEntry.update({where:{id:imported.saved.entries[0].id},data:{reference:'Synthetic incoming receipt'}});
   await db.account.update({where:{id:c.account.id},data:{updatedAt:new Date(Date.now()+1)}});
   await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()),/CHANGED/);
   assert.equal(await db.receiptImportPosting.count({where:{intakeId:c.intake.id}}),0);assert.equal(await db.payment.count({where:{accountId:c.account.id}}),0);assert.ok(before);
  });
  await t.test('document or final audit failure rolls back payment, ledger, balance, intake and receipt together',async()=>{
   for(const table of ['Document','AuditEvent']){
    const imported=await bankImport(),c=await reviewedSource('BANK_IMPORT_ENTRY',imported.saved.entries[0].id),preview=await previewImportedReceiptPosting(reviewer.scope,c.input),before=await counts(),constraint='receipt_post_'+randomUUID().replaceAll('-','');
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" CHECK (${table==='Document'?`"type" <> 'RECEIPT'`:`"action" <> 'receipt_import.posted'`}) NOT VALID`);
    try{await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()));}finally{await db.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${constraint}"`);}
    assert.equal(await counts(),before);assert.equal((await db.unidentifiedReceiptIntake.findUniqueOrThrow({where:{id:c.intake.id}})).status,'REVIEWED');
   }
  });
  await t.test('store scope, original approval revocation and signed source mutation cannot authorise a receipt',async()=>{
   const imported=await bankImport(),c=await reviewedSource('BANK_IMPORT_ENTRY',imported.saved.entries[0].id),preview=await previewImportedReceiptPosting(reviewer.scope,c.input),before=await counts();
   await assert.rejects(postImportedReceipt({...reviewer.scope,unrestrictedFacilities:false,facilityIds:[]},preview,randomUUID()),/FORBIDDEN/);
   const source=await db.receiptBankSourceProfile.findUniqueOrThrow({where:{id:bankSourceId}});
   await reviewReceiptBankSource(reviewer.scope,{...reviewBank(bankSourceId,source.revision,'revoke'),reference:'Synthetic source approval revoked before posting'});
   await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()),/APPROVAL_REQUIRED/);
   assert.equal(await counts(),before);
   const newRequest=await reviewReceiptBankSource(maker.scope,{...reviewBank(bankSourceId,source.revision+1,'request-review'),requestKey:randomUUID(),reference:'Synthetic renewed original source review'});
   await reviewReceiptBankSource(reviewer.scope,reviewBank(bankSourceId,newRequest.revision));
   await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()),/CHANGED/);
   const renewed=await previewImportedReceiptPosting(reviewer.scope,c.input);await assert.rejects(postImportedReceipt(reviewer.scope,{...renewed,amount:'100.26'},randomUUID()),/CHANGED/);assert.equal(await counts(),before);
  });
  await t.test('concurrent same-key post makes one original-date EFT receipt; saved retry and different-key replay cannot duplicate cash',async()=>{
   const imported=await bankImport(),c=await reviewedSource('BANK_IMPORT_ENTRY',imported.saved.entries[0].id),preview=await previewImportedReceiptPosting(reviewer.scope,c.input),key=randomUUID();
   const results=await Promise.all([postImportedReceipt(reviewer.scope,preview,key),postImportedReceipt(reviewer.scope,preview,key)]);
   assert.equal(results[0].posting!.id,results[1].posting!.id);assert.equal(results.filter(r=>!r.idempotent).length,1);
   const row=await db.receiptImportPosting.findUniqueOrThrow({where:{intakeId:c.intake.id},include:{payment:true,ledgerEntry:true,document:true}});
   assert.equal(row.payment.provider,'BANK_IMPORT');assert.equal(row.payment.providerRef,null);assert.equal(row.payment.method,'EFT');assert.equal(row.payment.amount.toFixed(2),'100.25');assert.equal(row.ledgerEntry.effectiveAt.toISOString(),'2026-10-13T22:00:00.000Z');assert.equal((await db.account.findUniqueOrThrow({where:{id:c.account.id}})).balance.toFixed(2),'99.75');assert.ok(row.document.content?.includes('date only'));assert.equal(row.document.type,'RECEIPT');
   assert.equal((await postImportedReceipt(reviewer.scope,preview,key)).idempotent,true);
   await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()),/SOURCE_REVIEW/);
   await assert.rejects(actOnUnidentifiedReceipt(maker.scope,{action:'withdraw',id:c.intake.id,facilityId:facility.id,revision:3,reference:'Attempted withdrawal after posting',confirmed:true}),/CONFLICT/);
   await assert.rejects(settlementAction(maker.scope,{action:'void-bank',id:imported.saved.id,reference:'Attempted void of posted receipt source',confirm:true}),/SETTLEMENT_BANK/);
   assert.equal((await importedReceiptPostingEvidence(db,org.id,c.intake.id))!.paymentId,row.paymentId);
  });
  await t.test('original Netcash settled card row posts CARD and links the same receipt; auth rows never become cash',async()=>{
   const connection=await db.integrationConnection.create({data:{organisationId:org.id,provider:'NETCASH',category:'PAYMENTS',config:{environment:'live',merchantAccountEncrypted:encryptIntegrationSecret('5'+String(Math.floor(Math.random()*1e10)).padStart(10,'0')),accountServiceKeyEncrypted:encryptIntegrationSecret(randomUUID())}}});
   const raw=['20261012\tOBL\t0\tOpening\t0\t+\t0','20261012\tPNA\t1\tSynthetic card authorisation\t0\t+\t0','20261012\tPNC\t2\tSynthetic settled card receipt\t100.25\t+\t0','20261012\tCBL\t0\tClosing\t100.25\t+\t0'].join('\n'),input={connectionId:connection.id,date:'2026-10-12',raw,sourceReference:'Synthetic original full Netcash statement'},p=await previewStatement(maker.scope,input),saved=await settlementAction(maker.scope,{action:'import',...input,fingerprint:p.fingerprint,confirm:true});
   assert.ok('id'in saved&&typeof saved.id==='string');const lines=await db.settlementLine.findMany({where:{statementId:saved.id}}),line=lines.find(l=>l.code==='PNC')!;
   assert.ok(!(await unidentifiedReceiptSources(maker.scope)).rows.some(r=>r.sourceId===lines.find(l=>l.code==='PNA')!.id));
   const c=await reviewedSource('NETCASH_STATEMENT_LINE',line.id),preview=await previewImportedReceiptPosting(reviewer.scope,c.input),posted=await postImportedReceipt(reviewer.scope,preview,randomUUID());
   const payment=await db.payment.findUniqueOrThrow({where:{id:posted.posting!.paymentId}});assert.equal(payment.method,'CARD');assert.equal(payment.provider,'NETCASH_STATEMENT');assert.equal(payment.providerRef,null);
   const linked=await db.settlementLine.findUniqueOrThrow({where:{id:line.id}});assert.equal(linked.paymentId,payment.id);assert.ok(linked.resolutionHash);assert.equal((await settlementDetail(maker.scope,saved.id)).lines.find(l=>l.id===line.id)!.issue,null);
   await assert.rejects(settlementAction(maker.scope,{action:'void',id:saved.id,revision:1,reference:'Attempted void of posted card receipt',confirm:true}),/SETTLEMENT_RECEIPT/);
   const reversalInput={accountId:c.account.id,sourceEntryId:posted.posting!.ledgerEntryId,kind:'REVERSAL',amount:'100.25',taxAmount:'0',reason:'Synthetic independently confirmed original card return',evidenceReference:'Synthetic original returned card source'},rp=await previewAdjustment(maker.scope,reversalInput),rr=await requestAdjustment(maker.scope,reversalInput,rp.fingerprint,randomUUID());await decideAdjustment(reviewer.scope,rr.id,'approve','Synthetic independent returned card review');
   const returnedRaw=['20261013\tOBL\t0\tOpening\t0\t+\t0','20261013\tPND\t3\tSynthetic returned card receipt\t100.25\t-\t0','20261013\tCBL\t0\tClosing\t-100.25\t+\t0'].join('\n'),returnedInput={connectionId:connection.id,date:'2026-10-13',raw:returnedRaw,sourceReference:'Synthetic later complete return statement'},returnedPreview=await previewStatement(maker.scope,returnedInput),returned=await settlementAction(maker.scope,{action:'import',...returnedInput,fingerprint:returnedPreview.fingerprint,confirm:true});
   assert.ok('id'in returned&&typeof returned.id==='string');const returnDetail=await settlementDetail(maker.scope,returned.id);await settlementAction(maker.scope,{action:'resolve',id:returned.id,revision:returnDetail.revision,lineId:returnDetail.lines[0].id,targetId:rr.id,reference:'Synthetic exact approved original return match',merchantConfirmed:false,requestKey:randomUUID()});assert.equal((await settlementDetail(maker.scope,returned.id)).lines[0].issue,null);

  });
  await t.test('imported cash supports existing independently reviewed MOVE and partial UNDO without a second payment or lost original date',async()=>{
   const bank=await bankImport(),c=await reviewedSource('BANK_IMPORT_ENTRY',bank.saved.entries[0].id),preview=await previewImportedReceiptPosting(reviewer.scope,c.input),posted=await postImportedReceipt(reviewer.scope,preview,randomUUID()),target=await account();
   const receipt=posted.posting!,request={sourceAccountId:c.account.id,sourceEntryId:receipt.ledgerEntryId,targetAccountId:target.id,amount:'25.25',reason:'Synthetic documented allocation correction',evidenceReference:'Synthetic original customer allocation evidence',requestKey:randomUUID()};
   const prepared=await previewReceiptReallocation(maker.scope,request),retained=await requestReceiptReallocation(maker.scope,request,prepared.fingerprint);await decideReceiptReallocation(reviewer.scope,retained.id,0,'approve','Synthetic independent original receipt correction');
   const move=await db.receiptReallocation.findUniqueOrThrow({where:{id:retained.id}}),undo={...request,operation:'UNDO' as const,reversesId:move.id,sourceAccountId:target.id,sourceEntryId:move.targetLedgerEntryId!,targetAccountId:c.account.id,amount:'10.00',requestKey:randomUUID()};
   const undoPreview=await previewReceiptReallocation(maker.scope,undo),undoRequest=await requestReceiptReallocation(maker.scope,undo,undoPreview.fingerprint);await decideReceiptReallocation(reviewer.scope,undoRequest.id,0,'approve','Synthetic independent partial undo');
   assert.equal(await db.payment.count({where:{accountId:{in:[c.account.id,target.id]}}}),1);assert.equal((await db.account.findUniqueOrThrow({where:{id:c.account.id}})).balance.toFixed(2),'115.00');assert.equal((await db.account.findUniqueOrThrow({where:{id:target.id}})).balance.toFixed(2),'184.75');
   const graph=await db.$transaction(tx=>receiptAllocationGraph(tx,reviewer.scope,receipt.paymentId));assert.equal(graph.receivedAt.toISOString(),'2026-10-13T22:00:00.000Z');assert.equal((await importedReceiptPostingEvidence(db,org.id,c.intake.id))!.paymentId,receipt.paymentId);
   assert.match((await importedReceiptDocument(reviewer.scope,c.intake.id)).content,/Original receipt date: 2026-10-14/);
  });
  await t.test('full controlled reversal preserves the original imported cash and receipt evidence and cannot be reposted',async()=>{
   const bank=await bankImport(),c=await reviewedSource('BANK_IMPORT_ENTRY',bank.saved.entries[0].id),preview=await previewImportedReceiptPosting(reviewer.scope,c.input),posted=await postImportedReceipt(reviewer.scope,preview,randomUUID()),receipt=posted.posting!;
   const input={accountId:c.account.id,sourceEntryId:receipt.ledgerEntryId,kind:'REVERSAL',amount:'100.25',taxAmount:'0',reason:'Synthetic reversal of documented incorrect original receipt',evidenceReference:'Synthetic independent source correction evidence'},p=await previewAdjustment(maker.scope,input),r=await requestAdjustment(maker.scope,input,p.fingerprint,randomUUID());await decideAdjustment(reviewer.scope,r.id,'approve','Synthetic independent full reversal');
   assert.equal((await db.payment.findUniqueOrThrow({where:{id:receipt.paymentId}})).status,'REVERSED');assert.equal((await db.account.findUniqueOrThrow({where:{id:c.account.id}})).balance.toFixed(2),'200.00');assert.equal((await importedReceiptPostingEvidence(db,org.id,c.intake.id))!.paymentStatus,'REVERSED');assert.equal(await db.payment.count({where:{accountId:c.account.id}}),1);
   await assert.rejects(postImportedReceipt(reviewer.scope,preview,randomUUID()),/SOURCE_REVIEW/);
  });
  await t.test('native bank source pages retain older identities and restrict approval options and cursors to current organisation/status',async()=>{
   for(let index=0;index<101;index++)await createReceiptBankSource(maker.scope,{...sourceInput,accountNumber:String(12345000000+index),label:'Synthetic paging source '+index,requestKey:randomUUID()});
   const first=await receiptBankSourceWorkspace(maker.scope);assert.equal(first.rows.length,100);assert.ok(first.nextCursor);
   const second=await receiptBankSourceWorkspace(maker.scope,first.nextCursor!);assert.equal(second.rows.length,2);assert.equal(second.nextCursor,null);assert.ok(second.rows.every(row=>!first.rows.some(prior=>prior.id===row.id)));assert.ok(second.rows.some(row=>row.id===bankSourceId));
   await assert.rejects(receiptBankSourceWorkspace(maker.scope,randomUUID()),/NOT_FOUND/);
   const approved=await settlementBankSourceOptions(maker.scope);assert.equal(approved.rows.length,1);assert.equal(approved.rows[0].id,bankSourceId);assert.ok(!JSON.stringify(approved).includes(sourceInput.accountNumber));
   await assert.rejects(settlementBankSourceOptions(maker.scope,first.rows[0].id),/NOT_FOUND/);
  });
 }finally{
  await db.receiptImportPosting.deleteMany({where:{organisationId:org.id}});
  await db.receiptReallocation.deleteMany({where:{organisationId:org.id}});await db.financialAdjustment.deleteMany({where:{organisationId:org.id}});
  await db.unidentifiedReceiptMatchProposal.deleteMany({where:{intake:{organisationId:org.id}}});await db.unidentifiedReceiptIntake.deleteMany({where:{organisationId:org.id}});
  await db.settlementLine.deleteMany({where:{statement:{organisationId:org.id}}});await db.settlementStatement.deleteMany({where:{organisationId:org.id}});await db.settlementBankEntry.deleteMany({where:{import:{organisationId:org.id}}});await db.settlementBankImport.deleteMany({where:{organisationId:org.id}});await db.receiptBankSourceProfile.deleteMany({where:{organisationId:org.id}});
  await db.auditEvent.deleteMany({where:{organisationId:org.id}});await db.document.deleteMany({where:{tenancy:{facilityId:facility.id}}});await db.ledgerEntry.deleteMany({where:{account:{customer:{organisationId:org.id}}}});await db.payment.deleteMany({where:{account:{customer:{organisationId:org.id}}}});await db.tenancy.deleteMany({where:{facilityId:facility.id}});await db.account.deleteMany({where:{customer:{organisationId:org.id}}});await db.customer.deleteMany({where:{organisationId:org.id}});await db.roleAssignment.deleteMany({where:{user:{organisationId:org.id}}});await db.role.deleteMany({where:{organisationId:org.id}});await db.user.deleteMany({where:{organisationId:org.id}});await db.integrationConnection.deleteMany({where:{organisationId:org.id}});await db.facility.deleteMany({where:{organisationId:org.id}});await db.organisation.delete({where:{id:org.id}});
  if(oldSigning===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=oldSigning;if(oldVault===undefined)delete process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY;else process.env.INTEGRATION_CONFIG_ENCRYPTION_KEY=oldVault;globalThis.fetch=originalFetch;await db.$disconnect();
 }
});

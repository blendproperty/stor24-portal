import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {AsyncLocalStorage} from "node:async_hooks";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {build} from "esbuild";
import {db} from "../../src/lib/db";
import type {Prisma} from "../../src/generated/prisma/client";
import {withRawRollbackFixture} from './finance-raw-rollback-fixture';
import {withFinanceSerializationFailure,rejectAfterFinanceRoleRevocation} from './finance-serialization-fixture';
import {previewReceiptReallocation,requestReceiptReallocation,decideReceiptReallocation} from "../../src/lib/receipt-reallocation-service";
import {receiptAllocationGraph} from "../../src/lib/receipt-reallocation-source";
import {settleVerifiedBookingPayment} from "../../src/lib/payments/booking-payment-settlement";
import {collectionsWorkspace,collectionCohortOutcomes} from "../../src/lib/collections-service";
import {previewAdjustment,requestAdjustment,decideAdjustment,recordRefundPayout} from "../../src/lib/adjustment-service";
import {netCollectionTotal} from "../../src/lib/finance/collection-total";
import {southAfricaDateKey} from "../../src/lib/south-africa-time";
import {customerHistory} from "../../src/lib/customer-history-service";
import {receiptCorrectionWorkspace,receiptCorrectionPreview,receiptCorrectionDocument} from "../../src/lib/receipt-reallocation-workspace";
import type {ReceiptReallocationInput} from "../../src/lib/receipt-reallocation-policy";

test("isolated receipt correction producers retain cash, approval, undo and source integrity",async t=>{
  const url=new URL(process.env.DATABASE_URL!);assert.equal(process.env.MERCHANDISE_DB_TEST,"isolated-ci");assert.ok(["localhost","127.0.0.1"].includes(url.hostname));assert.match(url.pathname,/^\/(?:receipt_correction_[a-z0-9_]+|merchandise_ci)$/);
  const organisations:string[]=[];
  async function fixture(withRoles=true){
    const org=await db.organisation.create({data:{name:"Synthetic receipt workflow",slug:randomUUID()}});organisations.push(org.id);
    const facility=await db.facility.create({data:{organisationId:org.id,name:"Synthetic correction store",code:randomUUID()}});
    const requester=await db.user.create({data:{organisationId:org.id,name:"Synthetic requester",email:randomUUID()+"@example.invalid"}}),reviewer=await db.user.create({data:{organisationId:org.id,name:"Synthetic reviewer",email:randomUUID()+"@example.invalid"}});
    if(withRoles){const role=await db.role.create({data:{organisationId:org.id,name:"Synthetic receipt authority",permissions:["adjustments.*","billing.view"]}});await db.roleAssignment.createMany({data:[requester,reviewer].map(user=>({userId:user.id,roleId:role.id,facilityId:facility.id}))});}
    const accounts=[];
    for(let n=0;n<3;n++){
      const customer=await db.customer.create({data:{organisationId:org.id,firstName:"PRIVATE-SYNTHETIC-CUSTOMER-"+n}});
      const account=await db.account.create({data:{customerId:customer.id,accountNumber:"SYNTHETIC-ACCOUNT-"+randomUUID(),balance:n===0?-200:n===1?450:0}});
      await db.tenancy.create({data:{facilityId:facility.id,customerId:customer.id,accountId:account.id,startDate:new Date("2026-01-01"),status:"ACTIVE"}});accounts.push(account);
      if(n===1)await db.ledgerEntry.create({data:{accountId:account.id,type:"CHARGE",amount:450,description:"Synthetic original charge",effectiveAt:new Date("2026-01-01")}});
    }
    const [source,target,third]=accounts;
    const payment=await db.payment.create({data:{accountId:source.id,status:"SUCCEEDED",amount:200,currency:"ZAR",method:"EFT",provider:"NETCASH",environment:"live",providerRef:randomUUID(),idempotencyKey:randomUUID(),processedAt:new Date("2026-01-02")}});
    const original=await db.ledgerEntry.create({data:{accountId:source.id,type:"PAYMENT",amount:200,description:"Synthetic original verified receipt",effectiveAt:new Date("2026-01-02"),externalRef:"netcash-payment:"+payment.id,metadata:{paymentId:payment.id,verifiedStatus:true,environment:"live"}}});
    const scope={organisationId:org.id,userId:requester.id,facilityIds:[facility.id],unrestrictedFacilities:false};
    return {org,facility,requester,reviewer,source,target,third,payment,original,scope,reviewScope:{...scope,userId:reviewer.id}};
  }
  type Fixture=Awaited<ReturnType<typeof fixture>>;
  const input=(f:Fixture):ReceiptReallocationInput=>({sourceAccountId:f.source.id,sourceEntryId:f.original.id,targetAccountId:f.target.id,amount:"75.25",reason:"Correct the documented synthetic receipt allocation",evidenceReference:"Synthetic independent source evidence",requestKey:randomUUID()});
  const balances=(f:Fixture)=>db.account.findMany({where:{id:{in:[f.source.id,f.target.id,f.third.id]}},orderBy:{id:"asc"},select:{id:true,balance:true}});
  const graph=(f:Fixture)=>db.$transaction(tx=>receiptAllocationGraph(tx,f.scope,f.payment.id),{isolationLevel:"RepeatableRead"});
  async function request(f:Fixture,data:ReceiptReallocationInput){const p=await previewReceiptReallocation(f.scope,data);return requestReceiptReallocation(f.scope,data,p.fingerprint);}
  const approve=(f:Fixture,id:string,reference="Synthetic independent approval")=>decideReceiptReallocation(f.reviewScope,id,0,"approve",reference);
  try{
    await t.test("actual HTTP handlers and database roles separate requester, independent approver and foreign-store receipt access",async()=>{
      const f=await fixture(false),foreign=await db.facility.create({data:{organisationId:f.org.id,name:"Synthetic private other store",code:randomUUID()}});
      const viewer=await db.user.create({data:{organisationId:f.org.id,name:"Synthetic foreign reviewer",email:randomUUID()+"@example.invalid"}});
      for(const [user,store,extra] of [[f.requester,f.facility,["adjustments.request"]],[f.reviewer,f.facility,["adjustments.approve"]],[viewer,foreign,["adjustments.approve"]]] as const){
        const role=await db.role.create({data:{organisationId:f.org.id,name:"Synthetic receipt HTTP "+randomUUID(),permissions:["adjustments.view","billing.view",...extra]}});
        await db.roleAssignment.create({data:{userId:user.id,roleId:role.id,facilityId:store.id}});
      }
      type Session={userId:string;sessionVersion:number};
      const sessions=new AsyncLocalStorage<Session|null>();
      const routeFailures:{code:string;startTimeout:boolean;expired:boolean}[]=[];
      const observeRouteFailure=(error:unknown)=>{
        const code=error&&typeof error==="object"&&"code" in error?String(error.code):"NONE",message=error instanceof Error?error.message:"";
        if(routeFailures.length<100)routeFailures.push({code,startTimeout:message.includes("Unable to start a transaction in the given time"),expired:message.includes("Transaction already closed")});
      };
      const tokens=new Map<string,Session>([f.requester,f.reviewer,viewer].map(user=>[randomUUID(),{userId:user.id,sessionVersion:user.sessionVersion}]));
      const [requesterToken,reviewerToken,foreignToken]=[...tokens.keys()];
      const bundle=await build({entryPoints:["src/app/api/v1/adjustments/receipt-reallocations/route.ts"],bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"synthetic-receipt-session-only",setup(b){
        // Observe existing catch classification without changing its response,
        // timeout, transaction, permission, or financial behaviour.
        b.onLoad({filter:/adjustments[\\/]receipt-reallocations[\\/]route\.ts$/},async a=>{
          const contents=await readFile(a.path,"utf8"),marker="function failure(error: unknown) {";assert.equal(contents.split(marker).length,2);
          return{loader:"ts",contents:contents.replace(marker,marker+" __observeRouteFailure(error);")};
        });
        b.onResolve({filter:/generated\/prisma\/client$/},()=>({path:resolve("src/generated/prisma/client.ts"),external:true}));
        b.onResolve({filter:/(?:^|\/)(db|session)$/},a=>({path:a.path,namespace:"fixture"}));
        b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path.endsWith("/db")?"export const db=__db;":"export const getSession=async()=>__sessions.getStore();"}));
      }}]});
      type Handler=(request:Request)=>Promise<Response>;
      const loaded={exports:{} as {GET:Handler;POST:Handler}};
      const transactionFailures:{code:string;startTimeout:boolean;expired:boolean;elapsedMs:number}[]=[];
      let forcedRawConflict:string|null=null;
      const observedDb=new Proxy(db,{get(target,key,receiver){
        if(key!=="$transaction")return Reflect.get(target,key,receiver);
        return async(...args:unknown[])=>{const began=performance.now();
          if(forcedRawConflict&&typeof args[0]==='function'){
            const original=args[0] as (tx:Prisma.TransactionClient)=>Promise<unknown>,query=forcedRawConflict;
            args[0]=async(tx:Parameters<typeof original>[0])=>{await tx.$queryRawUnsafe(query);return original(tx);};
          }
          try{return await Reflect.apply(target.$transaction,target,args);}catch(error){
          const code=error&&typeof error==="object"&&"code" in error?String(error.code):"UNKNOWN",message=error instanceof Error?error.message:"";
          if(transactionFailures.length<50)transactionFailures.push({code,startTimeout:message.includes("Unable to start a transaction in the given time"),expired:message.includes("Transaction already closed"),elapsedMs:Math.round(performance.now()-began)});
          throw error;
        }};
      }});
      new Function("require","module","exports","__db","__sessions","__observeRouteFailure",bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports,observedDb,sessions,observeRouteFailure);
      const server=createServer(async(incoming,outgoing)=>{
        try{
          const chunks=[];for await(const chunk of incoming)chunks.push(Buffer.from(chunk));
          const url=`http://127.0.0.1:${(server.address() as {port:number}).port}${incoming.url}`;
          const request=new Request(url,{method:incoming.method,headers:incoming.headers as Record<string,string>,...(incoming.method==="POST"?{body:Buffer.concat(chunks)}:{})});
          const token=String(incoming.headers.cookie??"").replace("fixture=","");
          const response=await sessions.run(tokens.get(token)??null,()=>loaded.exports[incoming.method==="POST"?"POST":"GET"](request));
          outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
        }catch{outgoing.writeHead(500);outgoing.end("Synthetic HTTP harness error");}
      });
      await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
      const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`,path="/api/v1/adjustments/receipt-reallocations";
      const call=(token:string,suffix="",body?:unknown,requestOrigin=origin)=>fetch(origin+path+suffix,{method:body===undefined?"GET":"POST",headers:{cookie:`fixture=${token}`,origin:requestOrigin,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
      try{
        assert.equal((await call("")).status,401);
        const initial=await call(requesterToken,`?sourceAccountId=${f.source.id}`);assert.equal(initial.status,200);
        const workspace=(await initial.json()).data;assert.equal(workspace.capabilities.canRequest,true);assert.equal(workspace.capabilities.canApprove,false);
        assert.equal(workspace.receipts[0].paymentReference,`STOR24 receipt ${f.payment.id}`);
        const data=input(f),previewResponse=await call(requesterToken,"",{action:"preview",input:data});assert.equal(previewResponse.status,200);
        const preview=(await previewResponse.json()).data;
        assert.equal((await call(requesterToken,"",{action:"request",input:data,fingerprint:preview.fingerprint,confirmed:true},"https://evil.example.invalid")).status,403);
        assert.equal((await call(reviewerToken,"",{action:"request",input:data,fingerprint:preview.fingerprint,confirmed:true})).status,403);
        const contenders=await Promise.all(Array.from({length:25},async()=>{
          const candidate={...data,requestKey:randomUUID()},response=await call(requesterToken,"",{action:"preview",input:candidate});
          assert.equal(response.status,200);return {input:candidate,fingerprint:(await response.json()).data.fingerprint};
        }));
        const began=performance.now();
        const responses=await Promise.all(contenders.map(async candidate=>{
          const response=await call(requesterToken,"",{action:"request",...candidate,confirmed:true});return {status:response.status,payload:await response.json()};
        }));
        const statusCounts=new Map<number,number>();for(const response of responses)statusCounts.set(response.status,(statusCounts.get(response.status)??0)+1);
        if(responses.some(r=>r.status!==200&&r.status!==409))console.error(JSON.stringify({fixture:"receipt-http-contention",statusCounts:Object.fromEntries(statusCounts),transactionFailures,routeFailures}));
        assert.ok(responses.every(r=>r.status===200||r.status===409),"contention produces a retained request or explicit review hold, never an unknown server result");
        assert.equal(responses.filter(r=>r.status===200).length,1);
        assert.ok(performance.now()-began<30000,"25 competing fixture requests complete within the staff request timeout");
        assert.equal(await db.receiptReallocation.count({where:{organisationId:f.org.id}}),1);
        const id=responses.find(r=>r.status===200)!.payload.data.id;
        const decision={action:"decide",id,revision:0,decision:"approve",reference:"Synthetic independent HTTP review",confirmed:true};
        assert.equal((await call(requesterToken,"",decision)).status,403);
        assert.equal((await call(foreignToken,"",decision)).status,404);
        assert.equal((await call(reviewerToken,"",decision)).status,200);
        const repeated=await call(reviewerToken,"",decision);assert.equal(repeated.status,200);assert.equal((await repeated.json()).data.idempotent,true);
        const doc=await call(requesterToken,`?document=${id}&side=source`);assert.equal(doc.status,200);
        assert.equal(doc.headers.get("x-stor24-data-classification"),"restricted");
        const html=await doc.text();assert.ok(html.includes(f.source.accountNumber));assert.ok(!html.includes(f.target.accountNumber));
        assert.equal((await call(foreignToken,`?document=${id}&side=source`)).status,404);
        assert.equal((await call(foreignToken,`?sourceAccountId=${f.source.id}`)).status,404);
        const next=input(f),nextPreview=await call(requesterToken,'',{action:'preview',input:next});assert.equal(nextPreview.status,200);const nextFingerprint=(await nextPreview.json()).data.fingerprint;
        for(const state of ['40001','40P01']as const){
          const result=await withRawRollbackFixture(state,3,async query=>{forcedRawConflict=query;try{return await call(requesterToken,'',{action:'request',input:next,fingerprint:nextFingerprint,confirmed:true});}finally{forcedRawConflict=null;}});
          assert.equal(result.value.status,409,'confirmed native raw rollback exhaustion is a review hold, not an unknown500');assert.equal(result.attempts,3);assert.equal(await db.receiptReallocation.count({where:{organisationId:f.org.id}}),1);
        }
        await db.roleAssignment.deleteMany({where:{userId:f.requester.id}});
        assert.equal((await call(requesterToken)).status,403,"current database grant revocation is effective without a new fixture session");
        assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
        assert.deepEqual(await db.ledgerEntry.findUniqueOrThrow({where:{id:f.original.id}}),f.original);
      }finally{await new Promise<void>(done=>server.close(()=>done()));await db.rateLimitBucket.deleteMany({where:{key:{startsWith:`dlp:${f.org.id}:`}}});}
    });
    await t.test("staff projection retains scoped receipt evidence, balances and private documents through MOVE and partial UNDO",async()=>{
      const f=await fixture(),capabilities={canRequest:true,canApprove:false};
      const first=await receiptCorrectionWorkspace(f.scope,{facilityId:f.facility.id,sourceAccountId:f.source.id},capabilities);
      assert.equal(first.receipts.length,1);assert.equal(first.receipts[0].paymentReference,`STOR24 receipt ${f.payment.id}`);
      assert.equal(first.receipts[0].remaining,"200.00");assert.ok(!JSON.stringify(first).includes(f.payment.providerRef!));
      const p=await receiptCorrectionPreview(f.scope,input(f));assert.equal(p.sourceBalanceAfter,"-124.75");assert.equal(p.targetBalanceAfter,"374.75");
      const moved=await request(f,input(f));
      const pending=await receiptCorrectionWorkspace(f.reviewScope,{}, {canRequest:false,canApprove:true});
      assert.equal(pending.requests[0].id,moved.id);assert.equal(pending.requests[0].retainedPreview?.sourceBalance,"-200");
      assert.equal(pending.requests[0].retainedPreview?.paymentReference,`STOR24 receipt ${f.payment.id}`);
      await approve(f,moved.id);
      const row=await db.receiptReallocation.findUniqueOrThrow({where:{id:moved.id}});
      const source=await receiptCorrectionDocument(f.scope,moved.id,"source"),target=await receiptCorrectionDocument(f.scope,moved.id,"target");
      assert.ok(source.content.includes(f.source.accountNumber));assert.ok(!source.content.includes(f.target.accountNumber));
      assert.ok(target.content.includes(f.target.accountNumber));assert.ok(!target.content.includes(f.source.accountNumber));
      assert.equal(await db.auditEvent.count({where:{entityId:moved.id,action:"receipt_reallocation.document_requested"}}),2);
      await assert.rejects(receiptCorrectionWorkspace({...f.scope,facilityIds:[]},{sourceAccountId:f.source.id},capabilities),/NOT_FOUND/);
      await assert.rejects(receiptCorrectionDocument({...f.scope,facilityIds:[]},moved.id,"source"),/NOT_FOUND/);
      const beforeDate=(await receiptCorrectionWorkspace(f.scope,{sourceAccountId:f.target.id},capabilities)).receipts[0].recordedAt;
      assert.equal(beforeDate,f.original.createdAt.toISOString());
      const undo=await request(f,{...input(f),operation:"UNDO",reversesId:moved.id,sourceAccountId:f.target.id,sourceEntryId:row.targetLedgerEntryId!,targetAccountId:f.source.id,amount:"25.25"});await approve(f,undo.id);
      const after=await receiptCorrectionWorkspace(f.scope,{sourceAccountId:f.source.id},capabilities);
      assert.equal(after.receipts[0].remaining,"150.00");assert.equal(after.requests.length,2);
      assert.ok(after.requests.every(r=>r.sourceAccountNumber&&r.targetAccountNumber&&r.retainedPreview));
      const next=await receiptCorrectionWorkspace(f.scope,{cursor:after.requests[0].id},capabilities);assert.deepEqual(next.requests.map(r=>r.id),[after.requests[1].id]);
      await db.customer.update({where:{id:f.source.customerId},data:{lastName:"Original Customer"}});
      const searched=await receiptCorrectionWorkspace(f.scope,{search:"Customer PRIVATE-SYNTHETIC-CUSTOMER-0"},capabilities);
      assert.deepEqual(searched.accounts.map(a=>a.id),[f.source.id]);
      await db.ledgerEntry.createMany({data:Array.from({length:26},()=>({accountId:f.source.id,type:"PAYMENT" as const,amount:0,description:"Synthetic unverified zero-value candidate",effectiveAt:new Date(),createdAt:new Date(f.original.createdAt.getTime()+1000)}))});
      const firstPage=await receiptCorrectionWorkspace(f.scope,{sourceAccountId:f.source.id},capabilities);
      assert.equal(firstPage.receipts.length,0);assert.ok(firstPage.nextReceiptCursor,"filtered empty pages retain a next cursor to older verified receipts");
      const older=await receiptCorrectionWorkspace(f.scope,{sourceAccountId:f.source.id,receiptCursor:firstPage.nextReceiptCursor!},capabilities);
      assert.equal(older.receipts[0].entryId,f.original.id);assert.equal(older.receipts[0].remaining,"150.00");assert.equal(older.nextReceiptCursor,null);
      await assert.rejects(receiptCorrectionWorkspace(f.scope,{sourceAccountId:f.target.id,receiptCursor:firstPage.nextReceiptCursor!},capabilities),/NOT_FOUND/);
      assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
      assert.deepEqual(await db.ledgerEntry.findUniqueOrThrow({where:{id:f.original.id}}),f.original);
    });
    await t.test("customer histories retain scoped MOVE and UNDO entries without duplicating external payment evidence",async()=>{
      const f=await fixture(),moved=await request(f,input(f));await approve(f,moved.id);
      const move=await db.receiptReallocation.findUniqueOrThrow({where:{id:moved.id}});
      const history=(customerId:string,financial:typeof f.scope|null=f.scope)=>customerHistory(f.scope,customerId,{kind:"ACCOUNT",search:""},{communications:null,collections:null,write:null,financial});
      const source=await history(f.source.customerId),target=await history(f.target.customerId);
      assert.deepEqual(new Set(source.entries.map(e=>e.id)),new Set([f.original.id,move.sourceLedgerEntryId!]));
      assert.ok(target.entries.some(e=>e.id===move.targetLedgerEntryId));
      assert.ok(!source.entries.some(e=>e.id===move.targetLedgerEntryId));
      assert.ok(!target.entries.some(e=>e.id===f.original.id||e.id===move.sourceLedgerEntryId));
      assert.equal((await history(f.source.customerId,null)).entries.length,0);
      assert.equal((await history(f.target.customerId,{...f.scope,facilityIds:[]})).entries.length,0);
      const undone=await request(f,{...input(f),operation:"UNDO",reversesId:move.id,sourceAccountId:f.target.id,sourceEntryId:move.targetLedgerEntryId!,targetAccountId:f.source.id,amount:"25.25"});await approve(f,undone.id);
      const undo=await db.receiptReallocation.findUniqueOrThrow({where:{id:undone.id}});
      const afterSource=await history(f.source.customerId),afterTarget=await history(f.target.customerId);
      assert.deepEqual(new Set(afterSource.entries.map(e=>e.id)),new Set([f.original.id,move.sourceLedgerEntryId!,undo.targetLedgerEntryId!]));
      assert.ok(afterTarget.entries.some(e=>e.id===undo.sourceLedgerEntryId));
      assert.ok(!afterTarget.entries.some(e=>e.id===undo.targetLedgerEntryId));
      assert.ok(afterSource.entries.every(e=>e.body?.includes("not independent bank settlement proof")));
      assert.equal(await db.payment.count({where:{account:{customer:{organisationId:f.org.id}}}}),1);
      assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
      assert.deepEqual(await db.ledgerEntry.findUniqueOrThrow({where:{id:f.original.id}}),f.original);
      await assert.rejects(customerHistory({...f.scope,facilityIds:[]},f.source.customerId,{kind:"ACCOUNT",search:""},{communications:null,collections:null,write:null,financial:f.scope}),/FORBIDDEN/);
    });
    await t.test("one partial move posts equal opposite entries and private account documents without a new external payment",async()=>{
      const f=await fixture(),before=await balances(f),data=input(f),r=await request(f,data);
      assert.deepEqual(await balances(f),before);await assert.rejects(decideReceiptReallocation(f.scope,r.id,0,"approve","Invalid self approval"),/INDEPENDENT/);
      await assert.rejects(decideReceiptReallocation({...f.reviewScope,facilityIds:[]},r.id,0,"approve","Outside store"),/NOT_FOUND/);
      await approve(f,r.id);assert.equal((await approve(f,r.id)).idempotent,true);
      const row=await db.receiptReallocation.findUniqueOrThrow({where:{id:r.id}});assert.equal(row.status,"POSTED");assert.equal(await db.payment.count({where:{account:{customer:{organisationId:f.org.id}}}}),1);
      assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);assert.deepEqual(await db.ledgerEntry.findUniqueOrThrow({where:{id:f.original.id}}),f.original);
      const proof=await graph(f);assert.equal(proof.positions.reduce((n,p)=>n+Math.round(Number(p.remaining)*100),0),20000);assert.equal(proof.positions.find(p=>p.entryId===f.original.id)?.remaining,"124.75");
      assert.equal((await db.account.findUniqueOrThrow({where:{id:f.source.id}})).balance.toFixed(2),"-124.75");assert.equal((await db.account.findUniqueOrThrow({where:{id:f.target.id}})).balance.toFixed(2),"374.75");
      const docs=await db.document.findMany({where:{id:{in:[row.sourceDocumentId!,row.targetDocumentId!]}}});assert.equal(docs.length,2);
      for(const doc of docs){assert.ok(!/[\u00c2\u00c3]/.test(doc.content??""));assert.ok(!doc.content?.includes("PRIVATE-SYNTHETIC-CUSTOMER"));assert.ok(!doc.content?.includes(doc.id===row.sourceDocumentId?f.target.accountNumber:f.source.accountNumber));}
      const count=await db.ledgerEntry.count({where:{accountId:{in:[f.source.id,f.target.id]}}});
      await settleVerifiedBookingPayment(f.payment.id,{reference:f.payment.providerRef!,amount:200,accepted:true,requestTrace:"synthetic-replay"});assert.equal(await db.ledgerEntry.count({where:{accountId:{in:[f.source.id,f.target.id]}}}),count);
    });
    await t.test("transitive allocations and partial undo restore the original receipt without rewriting it",async()=>{
      const f=await fixture(),first=await request(f,input(f));await approve(f,first.id);
      const firstRow=await db.receiptReallocation.findUniqueOrThrow({where:{id:first.id}});
      const next={...input(f),sourceAccountId:f.target.id,sourceEntryId:firstRow.targetLedgerEntryId!,targetAccountId:f.third.id,amount:"25.25"};
      const child=await request(f,next);await approve(f,child.id);
      const childRow=await db.receiptReallocation.findUniqueOrThrow({where:{id:child.id}});
      const undo:ReceiptReallocationInput={...input(f),operation:"UNDO",reversesId:first.id,sourceAccountId:f.target.id,sourceEntryId:firstRow.targetLedgerEntryId!,targetAccountId:f.source.id,amount:"75.25"};
      await assert.rejects(previewReceiptReallocation(f.scope,undo),/EXCEEDS_RECEIPT/);
      const undoChild=await request(f,{...input(f),operation:"UNDO",reversesId:child.id,sourceAccountId:f.third.id,sourceEntryId:childRow.targetLedgerEntryId!,targetAccountId:f.target.id,amount:"25.25"});await approve(f,undoChild.id);
      const partial=await request(f,{...undo,amount:"25.25"});await approve(f,partial.id);
      const rest=await request(f,{...undo,requestKey:randomUUID(),amount:"50.00"});await approve(f,rest.id);
      const proof=await graph(f);assert.equal(proof.positions.find(p=>p.entryId===f.original.id)?.remaining,"200.00");assert.ok(proof.positions.filter(p=>p.entryId!==f.original.id).every(p=>p.remaining==="0.00"));
      assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);assert.deepEqual(await db.ledgerEntry.findUniqueOrThrow({where:{id:f.original.id}}),f.original);
      assert.equal((await db.account.findUniqueOrThrow({where:{id:f.source.id}})).balance.toFixed(2),"-200.00");assert.equal((await db.account.findUniqueOrThrow({where:{id:f.target.id}})).balance.toFixed(2),"450.00");assert.equal((await db.account.findUniqueOrThrow({where:{id:f.third.id}})).balance.toFixed(2),"0.00");
    });
    await t.test("collections and native financial outcomes conserve allocations without treating old cash as a new promise receipt",async()=>{
      const f=await fixture(),today=southAfricaDateKey(new Date());
      const c=await db.collectionCase.create({data:{accountId:f.target.id,terms:{dueDays:0,allocation:"OLDEST_DUE_FIRST",approvalReference:"Synthetic finance approved terms",overrides:[]}}});
      await db.collectionPromise.create({data:{caseId:c.id,amount:"75.25",dueDate:today,createdAt:new Date(Date.now()-1),createdById:f.requester.id}});
      const data=input(f),r=await request(f,data);
      assert.match((await collectionsWorkspace(f.scope,today)).rows.find(a=>a.id===f.target.id)!.hold!,/allocation awaiting independent review/);
      await approve(f,r.id);
      const queue=await collectionsWorkspace(f.scope,today),target=queue.rows.find(a=>a.id===f.target.id)!;assert.equal(target.ageing.issue,null);assert.equal(target.ageing.overdue,37475);assert.equal(target.promises[0].progress?.received,0);assert.equal(target.promises[0].progress?.covered,false);
      const outcomes=await db.$transaction(tx=>collectionCohortOutcomes(tx,f.scope,[f.source.id,f.target.id,f.third.id],today));assert.ok(outcomes.every(r=>!r.issue));assert.equal(outcomes.reduce((n,r)=>n+(r.netReceiptCents??0),0),20000);assert.equal(await netCollectionTotal(f.scope,new Date(0)),200);
      await db.auditEvent.updateMany({where:{entityId:r.id,action:"receipt_reallocation.posted"},data:{action:"synthetic.unproven_allocation"}});
      const held=await db.$transaction(tx=>collectionCohortOutcomes(tx,f.scope,[f.source.id,f.target.id],today));assert.ok(held.every(r=>r.issue&&r.netReceiptCents===null&&r.overdueCents===null));
    });
    await t.test("refunds are limited to the original receipt position and a fully undone allocation permits the existing full reversal",async()=>{
      const f=await fixture(),r=await request(f,input(f));await approve(f,r.id);
      const other=await db.payment.create({data:{accountId:f.source.id,status:"SUCCEEDED",amount:100,method:"EFT",provider:"NETCASH",environment:"live",idempotencyKey:randomUUID(),processedAt:new Date()}});
      await db.ledgerEntry.create({data:{accountId:f.source.id,type:"PAYMENT",amount:100,description:"Synthetic separate receipt",effectiveAt:new Date(),externalRef:"netcash-payment:"+other.id,metadata:{paymentId:other.id,verifiedStatus:true,environment:"live"}}});await db.account.update({where:{id:f.source.id},data:{balance:{decrement:100}}});
      const refund={accountId:f.source.id,kind:"REFUND" as const,amount:"124.76",taxAmount:"0",sourceEntryId:f.original.id,reason:"Synthetic external refund recorded separately",evidenceReference:"Synthetic refund proof"};
      await assert.rejects(previewAdjustment(f.scope,refund),/EXCEEDS_SOURCE/);
      const valid={...refund,amount:"25.25"},preview=await previewAdjustment(f.scope,valid),adjustment=await requestAdjustment(f.scope,valid,preview.fingerprint,randomUUID());
      await decideAdjustment(f.reviewScope,adjustment.id,"approve","Synthetic refund approval");await recordRefundPayout(f.reviewScope,adjustment.id,"SYNTHETIC-PAYOUT-"+randomUUID(),southAfricaDateKey(new Date()));
      assert.equal((await graph(f)).positions.find(p=>p.entryId===f.original.id)?.remaining,"99.50");assert.equal(await netCollectionTotal(f.scope,new Date(0)),274.75);
      const g=await fixture(),move=await request(g,input(g));await approve(g,move.id);const moved=await db.receiptReallocation.findUniqueOrThrow({where:{id:move.id}});
      const undo=await request(g,{...input(g),operation:"UNDO",reversesId:move.id,sourceAccountId:g.target.id,sourceEntryId:moved.targetLedgerEntryId!,targetAccountId:g.source.id});await approve(g,undo.id);
      const reversal={...refund,accountId:g.source.id,sourceEntryId:g.original.id,kind:"REVERSAL" as const,amount:"200.00"},p=await previewAdjustment(g.scope,reversal),a=await requestAdjustment(g.scope,reversal,p.fingerprint,randomUUID());await decideAdjustment(g.reviewScope,a.id,"approve","Synthetic full receipt reversal");
      assert.equal((await graph(g)).root.status,"REVERSED");assert.equal(await netCollectionTotal(g.scope,new Date(0)),0);
      const count=await db.ledgerEntry.count({where:{accountId:g.source.id}});await settleVerifiedBookingPayment(g.payment.id,{reference:g.payment.providerRef!,amount:200,accepted:true,requestTrace:"synthetic-after-reversal"});assert.equal(await db.ledgerEntry.count({where:{accountId:g.source.id}}),count);assert.equal((await db.payment.findUniqueOrThrow({where:{id:g.payment.id}})).status,"REVERSED");
    });
    await t.test("concurrent identical requests are idempotent and competing approvals post once",async()=>{
      const f=await fixture(),data=input(f),p=await previewReceiptReallocation(f.scope,data);
      const requests=await Promise.all([requestReceiptReallocation(f.scope,data,p.fingerprint),requestReceiptReallocation(f.scope,data,p.fingerprint)]);assert.equal(requests[0].id,requests[1].id);
      const approvals=await Promise.allSettled([approve(f,requests[0].id),approve(f,requests[0].id)]);assert.ok(approvals.some(r=>r.status==="fulfilled"));assert.equal(await db.receiptReallocation.count({where:{organisationId:f.org.id,status:"POSTED"}}),1);assert.equal((await graph(f)).positions.find(p=>p.entryId===f.original.id)?.remaining,"124.75");
    });
    await t.test("a proven rolled-back serialization conflict retries the same approval without duplicate effects",async()=>{
      const f=await fixture(),r=await request(f,input(f)),suffix=randomUUID().replaceAll("-",""),name="receipt_retry_"+suffix,sequence="receipt_seq_"+suffix;assert.match(f.org.id,/^[a-z0-9]+$/);
      await db.$executeRawUnsafe(`CREATE SEQUENCE "${sequence}"`);
      await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organisationId"='${f.org.id}' THEN IF NEW."action"='receipt_reallocation.posted' THEN IF nextval('${sequence}')=1 THEN RAISE EXCEPTION 'Synthetic serialization rollback' USING ERRCODE='40001'; END IF; END IF; END IF; RETURN NEW; END; $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
      try{await approve(f,r.id);}finally{await db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);await db.$executeRawUnsafe(`DROP SEQUENCE "${sequence}"`);}
      assert.equal(await db.receiptReallocation.count({where:{organisationId:f.org.id,status:"POSTED"}}),1);assert.equal(await db.auditEvent.count({where:{entityId:r.id,action:"receipt_reallocation.posted"}}),1);assert.equal(await db.document.count({where:{tenancy:{facilityId:f.facility.id}}}),2);assert.equal((await graph(f)).positions.find(p=>p.entryId===f.original.id)?.remaining,"124.75");assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
    });
    await t.test("changed sources cannot post and a requested correction can be cancelled without money changes",async()=>{
      const f=await fixture(),r=await request(f,input(f));
      await db.ledgerEntry.create({data:{accountId:f.source.id,type:"CHARGE",amount:1,description:"Synthetic intervening event",effectiveAt:new Date()}});await db.account.update({where:{id:f.source.id},data:{balance:{increment:1}}});
      const before=await balances(f);await assert.rejects(approve(f,r.id),/CHANGED/);assert.deepEqual(await balances(f),before);
      await decideReceiptReallocation(f.scope,r.id,0,"cancel","Synthetic stale request cancellation");assert.equal((await db.receiptReallocation.findUniqueOrThrow({where:{id:r.id}})).status,"CANCELLED");assert.deepEqual(await balances(f),before);
    });
    await t.test("posted audit failure rolls back both balances, entries, documents and decision",async()=>{
      const f=await fixture(),r=await request(f,input(f)),before=await balances(f),entryCount=await db.ledgerEntry.count({where:{account:{customer:{organisationId:f.org.id}}}});
      const name="receipt_post_"+randomUUID().replaceAll("-","");assert.match(f.org.id,/^[a-z0-9]+$/);
      await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${name}" CHECK ("organisationId" <> '${f.org.id}' OR "action" <> 'receipt_reallocation.posted') NOT VALID`);
      try{await assert.rejects(approve(f,r.id));}finally{await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${name}"`);}
      assert.deepEqual(await balances(f),before);assert.equal(await db.ledgerEntry.count({where:{account:{customer:{organisationId:f.org.id}}}}),entryCount);assert.equal(await db.document.count({where:{tenancy:{facilityId:f.facility.id}}}),0);assert.equal((await db.receiptReallocation.findUniqueOrThrow({where:{id:r.id}})).status,"PENDING_APPROVAL");assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
    });
    await t.test('real role revocation after native rollback stops receipt requests and approvals without losing original cash',async()=>{
      for(const action of ['request','approve']as const){
        const f=await fixture(),data=input(f),pending=action==='approve'?await request(f,data):null,before=await balances(f);
        const count=await db.ledgerEntry.count({where:{account:{customer:{organisationId:f.org.id}}}}),actor=action==='request'?f.scope:f.reviewScope;
        const preview=action==='request'?await previewReceiptReallocation(f.scope,data):null;
        const work=action==='request'?()=>requestReceiptReallocation(f.scope,data,preview!.fingerprint):()=>approve(f,pending!.id);
        const result=await withFinanceSerializationFailure(f.org.id,'receipt_reallocation.'+(action==='request'?'requested':'posted'),1,()=>rejectAfterFinanceRoleRevocation(actor.userId,work,action==='approve'?1:2));
        assert.equal(result.attempts,1);assert.equal(result.value.attempts,action==='approve'?1:2,'receipt approval revocation is rejected by the fresh preflight before opening another write transaction');assert.deepEqual(await balances(f),before);
        assert.equal(await db.ledgerEntry.count({where:{account:{customer:{organisationId:f.org.id}}}}),count);assert.equal(await db.document.count({where:{tenancy:{facilityId:f.facility.id}}}),0);
        assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:f.payment.id}}),f.payment);
        assert.equal(await db.receiptReallocation.count({where:{organisationId:f.org.id}}),pending?1:0);if(pending)assert.equal((await db.receiptReallocation.findUniqueOrThrow({where:{id:pending.id}})).status,'PENDING_APPROVAL');
      }
    });
  }finally{
    for(const organisationId of organisations){
      await db.receiptReallocation.deleteMany({where:{organisationId}});await db.auditEvent.deleteMany({where:{organisationId}});await db.document.deleteMany({where:{tenancy:{facility:{organisationId}}}});await db.collectionPromise.deleteMany({where:{case:{account:{customer:{organisationId}}}}});await db.collectionActivity.deleteMany({where:{case:{account:{customer:{organisationId}}}}});await db.collectionCase.deleteMany({where:{account:{customer:{organisationId}}}});await db.financialAdjustment.deleteMany({where:{organisationId}});await db.ledgerEntry.deleteMany({where:{account:{customer:{organisationId}}}});await db.payment.deleteMany({where:{account:{customer:{organisationId}}}});await db.tenancy.deleteMany({where:{facility:{organisationId}}});await db.account.deleteMany({where:{customer:{organisationId}}});await db.organisation.delete({where:{id:organisationId}});
    }
    await db.$disconnect();
  }
});

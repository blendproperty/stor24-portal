/** Operator maintenance; never charges, retries checkout or impersonates a user. */
import {readFile} from "node:fs/promises";
import {z} from "zod";
import {db} from "../src/lib/db";
import {netcashPaymentFacility,recoverNetcashTestPaymentEvidence} from "../src/lib/payments/netcash-payment-evidence";
import {isTestPayment} from "../src/lib/payments/payment-evidence";

async function main(){
 const args=process.argv.slice(2);
 if(args.length<1||args.length>2||(args.length===2&&args[1]!=="--apply"))throw Error("NETCASH_MAINTENANCE_USAGE");
 const file=await readFile(args[0]);if(file.length>8192)throw Error("NETCASH_MAINTENANCE_INPUT_TOO_LARGE");
 const input=z.object({organisationId:z.string().cuid(),facilityId:z.string().cuid(),maintenanceReference:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 .:_-]{7,99}$/),paymentIds:z.array(z.string().cuid()).min(1).max(20).refine(ids=>new Set(ids).size===ids.length)}).strict().parse(JSON.parse(file.toString()));
 const scope={organisationId:input.organisationId,facilityIds:[input.facilityId],unrestrictedFacilities:false};
 // Validate the complete, explicitly named target set before any metadata write.
 for(const id of input.paymentIds){
  const p=await db.payment.findFirst({where:{id,provider:"NETCASH",method:{in:["PAY_NOW","CARD_SUBSCRIPTION"]},account:{customer:{organisationId:input.organisationId}}},include:{account:{include:{customer:{select:{organisationId:true}},tenancy:{select:{facilityId:true,customerId:true}}}}}});
  if(!p||p.environment!=="sandbox"||!isTestPayment(p)||!(p.providerOriginalRef??p.providerRef))throw Error("NETCASH_MAINTENANCE_TARGET_REVIEW");
  if(await netcashPaymentFacility(scope,p)!==input.facilityId)throw Error("NETCASH_MAINTENANCE_TARGET_REVIEW");
 }
 const apply=args[1]==="--apply";
 if(apply&&process.env.NETCASH_EVIDENCE_MAINTENANCE_ENABLED!=="true")throw Error("NETCASH_MAINTENANCE_DISABLED");
 if(!apply){console.log(JSON.stringify({mode:"preview",eligibleTestPayments:input.paymentIds.length,providerRequests:0,metadataWrites:0,financialMutation:false}));return;}
 const methods:Record<string,number>={};let recovered=0;
 for(const paymentId of input.paymentIds){
  try{
   const result=await recoverNetcashTestPaymentEvidence({...input,paymentId});
   const label=result?.method??"Unclassified";methods[label]=(methods[label]??0)+1;recovered++;
  }catch(error){
   const code=error instanceof Error&&/^NETCASH_[A-Z_]+$/.test(error.message)?error.message:"NETCASH_MAINTENANCE_REVIEW_REQUIRED";
   console.log(JSON.stringify({mode:"apply",recovered,requested:input.paymentIds.length,methods,stoppedAt:recovered+1,error:code,financialMutation:false}));throw Error("NETCASH_MAINTENANCE_INCOMPLETE");
  }
 }
 console.log(JSON.stringify({mode:"apply",recovered,methods,actorKind:"SYSTEM_MAINTENANCE",financialMutation:false}));
}
main().catch(error=>{console.error(error instanceof Error&&/^NETCASH_[A-Z_]+$/.test(error.message)?error.message:"NETCASH_MAINTENANCE_INPUT_OR_RUNTIME_REVIEW");process.exitCode=1}).finally(()=>db.$disconnect());

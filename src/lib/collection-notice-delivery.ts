import { z } from "zod";

const itemSchema=z.object({accountId:z.string().min(1).max(100),id:z.string().min(1).max(120),revision:z.string().uuid(),recipient:z.email(),subject:z.string(),text:z.string()}).strict();
const audienceSchema=z.array(itemSchema).min(1).max(20).refine(items=>new Set(items.map(item=>item.accountId)).size===items.length&&new Set(items.map(item=>item.id)).size===items.length);
type Item=z.infer<typeof itemSchema>;
export type NoticeDeliveryResult={accountId:string;status:"NOT_ATTEMPTED"|"IN_PROGRESS"|"PROVIDER_ACCEPTED"|"REVIEW_REQUIRED"};
const responseSchema=z.object({notice:itemSchema.extend({status:z.enum(["ACCEPTED","SENDING","REVIEW_REQUIRED"]),accepted:z.boolean(),deliveryVerified:z.literal(false)}).strip()});

/** Browser orchestration only. Each dispatch uses the existing durable server claim.
 * An interrupted or uncertain request never advances or retries automatically. */
export async function deliverReviewedNotices(items:Item[],dispatch:(item:Item,signal:AbortSignal)=>Promise<unknown>,signal:AbortSignal,onUpdate:(results:NoticeDeliveryResult[])=>void){
  const audience=audienceSchema.parse(items);
  const results:NoticeDeliveryResult[]=audience.map(item=>({accountId:item.accountId,status:"NOT_ATTEMPTED"}));
  const update=()=>onUpdate(results.map(item=>({...item})));
  update();
  for(const [index,item] of audience.entries()){
    if(signal.aborted)break;
    results[index].status="IN_PROGRESS";update();
    try{
      const response=responseSchema.parse(await dispatch(item,signal)).notice;
      if(response.id!==item.id||response.accountId!==item.accountId||response.revision!==item.revision||response.recipient!==item.recipient||response.subject!==item.subject||response.text!==item.text||(response.status==="ACCEPTED")!==response.accepted)throw Error("NOTICE_RESULT_UNVERIFIED");
      results[index].status=response.status==="ACCEPTED"?"PROVIDER_ACCEPTED":"REVIEW_REQUIRED";
    }catch{results[index].status="REVIEW_REQUIRED"}
    update();
    if(results[index].status!=="PROVIDER_ACCEPTED")break;
  }
  return results.map(item=>({...item}));
}

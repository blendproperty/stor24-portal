import { z } from "zod";
const account=z.string().min(1).max(100);
export const noticeBatchAccountsSchema=z.array(account).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,{message:"Select each account once."});
export const noticeBatchPreparationSchema=z.object({items:z.array(z.object({accountId:account,fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(20).refine(items=>new Set(items.map(item=>item.accountId)).size===items.length,{message:"Select each account once."}),confirm:z.literal(true)}).strict();
export const noticeBatchApprovalSchema=z.object({
  items:z.array(z.object({accountId:account,id:z.string().min(1).max(120),revision:z.string().uuid()}).strict()).min(1).max(20).refine(items=>new Set(items.map(item=>item.accountId)).size===items.length&&new Set(items.map(item=>item.id)).size===items.length,{message:"Review each account and notice once."}),
  reference:z.string().trim().min(3).max(240),confirm:z.literal(true),
}).strict();

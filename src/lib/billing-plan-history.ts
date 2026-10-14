import {createHash} from "node:crypto";
import {z} from "zod";
import {billingPlanSchema,type BillingPlan} from "./monthly-billing-policy";
import type {Prisma} from "@/generated/prisma/client";
export const BILLING_HISTORY_DOMAIN="MONTHLY_BILLING_VERSION";
const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)])):value;
export const billingPlanHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
const versionSchema=z.object({schemaVersion:z.literal(1),recordNumber:z.number().int().positive().max(10000000),organisationId:z.string(),facilityId:z.string(),accountId:z.string(),kind:z.enum(["OBSERVED_LEGACY","APPROVED_CHANGE"]),recordedAt:z.iso.datetime(),sourcePlanUpdatedAt:z.iso.datetime().nullable(),actorId:z.string().nullable(),plan:billingPlanSchema,planHash:z.string().regex(/^[a-f0-9]{64}$/),previousHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type BillingPlanVersion=z.infer<typeof versionSchema>;
const versionName=(accountId:string,n:number)=>`${accountId}:${String(n).padStart(8,"0")}`;
const versionId=(org:string,facility:string,account:string,n:number)=>`billing-version:${billingPlanHash([org,facility,account,n])}`;
export function verifyBillingPlanVersion(row:{id:string;name:string;status:string;config:unknown},org:string,facility:string,account:string){
 const parsed=versionSchema.safeParse(row.config);if(!parsed.success)throw Error("BILLING_HISTORY_INTEGRITY");const v=parsed.data;const{hash,...snapshot}=v;
 if(row.status!=="RECORDED"||v.organisationId!==org||v.facilityId!==facility||v.accountId!==account||row.id!==versionId(org,facility,account,v.recordNumber)||row.name!==versionName(account,v.recordNumber)||billingPlanHash(snapshot)!==hash||billingPlanHash(v.plan)!==v.planHash||(v.kind==="APPROVED_CHANGE"&&!v.actorId))throw Error("BILLING_HISTORY_INTEGRITY");return v;
}
export async function retainBillingPlanVersion(tx:Prisma.TransactionClient,input:{organisationId:string;facilityId:string;accountId:string;actorId:string;plan:BillingPlan;previousPlan:unknown;previousReady:boolean;previousUpdatedAt:Date|null}){
 const {organisationId:org,facilityId:facility,accountId:account}=input;
 const previousRow=await tx.configurationProfile.findFirst({where:{organisationId:org,facilityId:facility,domain:BILLING_HISTORY_DOMAIN,name:{startsWith:`${account}:`}},orderBy:{name:"desc"}});
 let previous=previousRow?verifyBillingPlanVersion(previousRow,org,facility,account):null;
 if(previous&&(!input.previousReady||billingPlanHash(input.previousPlan)!==previous.planHash))throw Error("BILLING_HISTORY_SOURCE_CHANGED");
 const append=async(plan:BillingPlan,kind:BillingPlanVersion["kind"],actorId:string|null,updatedAt:Date|null)=>{const recordNumber=(previous?.recordNumber??0)+1;if(recordNumber>10000000)throw Error("BILLING_HISTORY_LIMIT");const snapshot={schemaVersion:1 as const,recordNumber,organisationId:org,facilityId:facility,accountId:account,kind,recordedAt:new Date().toISOString(),sourcePlanUpdatedAt:updatedAt?.toISOString()??null,actorId,plan,planHash:billingPlanHash(plan),previousHash:previous?.hash??null};const value={...snapshot,hash:billingPlanHash(snapshot)};await tx.configurationProfile.create({data:{id:versionId(org,facility,account,recordNumber),organisationId:org,facilityId:facility,domain:BILLING_HISTORY_DOMAIN,name:versionName(account,recordNumber),status:"RECORDED",config:value}});await tx.auditEvent.create({data:{organisationId:org,facilityId:facility,actorId:input.actorId,action:"billing.plan_version_recorded",entityType:"Account",entityId:account,after:{recordNumber,kind,hash:value.hash,previousHash:value.previousHash,planHash:value.planHash}}});previous=value;};
 if(!previous&&input.previousReady){const parsed=billingPlanSchema.safeParse(input.previousPlan);if(!parsed.success)throw Error("BILLING_HISTORY_SOURCE_INVALID");await append(parsed.data,"OBSERVED_LEGACY",null,input.previousUpdatedAt)}
 if(previous?.planHash===billingPlanHash(input.plan))return{changed:false,version:previous};
 await append(input.plan,"APPROVED_CHANGE",input.actorId,null);return{changed:true,version:previous!};
}
export async function readBillingPlanVersions(tx:Prisma.TransactionClient,org:string,facility:string,account:string,before?:number){
 const rows=await tx.configurationProfile.findMany({where:{organisationId:org,facilityId:facility,domain:BILLING_HISTORY_DOMAIN,name:{startsWith:`${account}:`,...(before?{lt:versionName(account,before)}:{})}},orderBy:{name:"desc"},take:21});
 const versions=rows.map(row=>verifyBillingPlanVersion(row,org,facility,account));
 for(let i=0;i<versions.length-1;i++)if(versions[i].recordNumber!==versions[i+1].recordNumber+1||versions[i].previousHash!==versions[i+1].hash)throw Error("BILLING_HISTORY_INTEGRITY");
 return{versions:versions.slice(0,20),nextBefore:versions.length>20?versions[19].recordNumber:null,coverage:"Recorded plan approvals and changes only. Legacy baseline is observed now; effective historical periods and historical charge amounts are not inferred."};
}

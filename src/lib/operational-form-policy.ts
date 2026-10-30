import { z } from "zod";
export const formText=(max:number)=>z.string().trim().max(max).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
const line=(max:number)=>formText(max).refine(v=>!/[\r\n]/.test(v));
const date=z.iso.date().nullable();
export const maintenanceReportSchema=z.object({
  discoveredOn:date,area:line(240).min(2),actionRequired:formText(2000).min(3),reportedOn:date,outcome:formText(2000),resolvedOn:date,notes:formText(4000),
  pictureReferences:z.array(line(500).min(1)).max(10).refine(v=>new Set(v).size===v.length),
  quoteAmount:z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/).nullable(),quoteCurrency:z.literal("ZAR"),
  quoteDecision:z.enum(["UNKNOWN","PENDING","REJECTED","NOT_APPROVED","APPROVED_EXTERNALLY"]),quoteReference:line(500),
  certificateDescription:line(240),certificateReference:line(500),certificateExpiresOn:date,
}).strict().superRefine((v,ctx)=>{
  if(v.discoveredOn&&[v.reportedOn,v.resolvedOn].some(d=>d&&d<v.discoveredOn!))ctx.addIssue({code:"custom",message:"Reported/resolved dates cannot precede discovery."});
  if(["REJECTED","NOT_APPROVED","APPROVED_EXTERNALLY"].includes(v.quoteDecision)&&v.quoteReference.length<3)ctx.addIssue({code:"custom",message:"Record the external decision reference."});
  if(v.certificateExpiresOn&&(!v.certificateDescription||!v.certificateReference))ctx.addIssue({code:"custom",message:"Certificate description and evidence reference are required for a recorded expiry."});
});
export type MaintenanceReport=z.infer<typeof maintenanceReportSchema>;
export const emptyMaintenanceReport:MaintenanceReport={discoveredOn:null,area:"",actionRequired:"",reportedOn:null,outcome:"",resolvedOn:null,notes:"",pictureReferences:[],quoteAmount:null,quoteCurrency:"ZAR",quoteDecision:"UNKNOWN",quoteReference:"",certificateDescription:"",certificateReference:"",certificateExpiresOn:null};
export const acknowledgementText="I acknowledge these are my visit details. This does not authorise access or replace a lease or identity check.";
export const visitorEntrySchema=z.object({kind:z.enum(["VISITOR","CLIENT_ATTENDANCE"]),businessDate:z.iso.date(),timeIn:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),name:line(160).min(2),unitId:z.cuid().nullable(),contact:line(160),signatureName:line(160).min(2),clientConfirmed:z.literal(true),policyReference:line(500).min(3)}).strict().superRefine((v,ctx)=>{
  if(v.kind==="VISITOR"&&!v.contact)ctx.addIssue({code:"custom",message:"Visitor contact is required."});
  if(v.kind==="CLIENT_ATTENDANCE"&&(v.unitId||v.contact))ctx.addIssue({code:"custom",message:"The client attendance form does not collect a unit or contact."});
});
export function sastInstant(date:string,time:string){z.iso.date().parse(date);if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("FORM_TIME");return new Date(`${date}T${time}:00+02:00`);}

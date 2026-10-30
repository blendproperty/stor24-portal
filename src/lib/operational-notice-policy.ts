import { z } from "zod";

export const noticeVariables = ["customer_name", "store_name", "notice_date", "effective_time", "details", "contact_details"] as const;
const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
export const noticeTemplateSchema = z.object({name:text(100),subject:text(160).refine(v=>!/[\r\n]/.test(v)),body:text(8000)}).strict().superRefine((v,ctx)=>{
  const source=v.subject+"\n"+v.body;
  if (/\{\{|\}\}/.test(source.replace(/\{\{([a-z_]+)\}\}/g,(_,key)=>noticeVariables.includes(key)?"":"{{")))ctx.addIssue({code:"custom",message:"Use only the listed {{variables}}."});
});
export const noticeValuesSchema=z.object({notice_date:text(120),effective_time:text(240),details:text(2000),contact_details:text(500)}).strict().refine(v=>Object.values(v).every(s=>!/[{}]/.test(s)),"Variable values cannot contain braces.");
export const noticeAudienceSchema=z.array(z.string().min(1).max(100)).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,"Choose unique customers.");
export const noticeStarters = [
  {name:"Trading hours",subject:"{{store_name}}: trading hours",body:"Hello {{customer_name}},\n\nTrading hours at {{store_name}} from {{effective_time}}:\n{{details}}\n\nFor enquiries: {{contact_details}}\n\nSTOR24 · {{notice_date}}"},
  {name:"Immediate closure",subject:"{{store_name}}: closure notice",body:"Hello {{customer_name}},\n\nPlease note the closure at {{store_name}} effective {{effective_time}}.\n{{details}}\n\nFor enquiries: {{contact_details}}\n\nSTOR24 · {{notice_date}}"},
  {name:"Maintenance",subject:"{{store_name}}: maintenance notice",body:"Hello {{customer_name}},\n\nMaintenance at {{store_name}} is planned for {{effective_time}}.\n{{details}}\n\nFor enquiries: {{contact_details}}\n\nSTOR24 · {{notice_date}}"},
] as const;

export function renderOperationalNotice(template:unknown,values:unknown,customerName:string,storeName:string){
  const t=noticeTemplateSchema.parse(template),v={...noticeValuesSchema.parse(values),customer_name:customerName,store_name:storeName};
  const merge=(s:string)=>s.replace(/\{\{([a-z_]+)\}\}/g,(_,key)=>v[key as keyof typeof v]);
  const subject=merge(t.subject),body=merge(t.body);
  if(subject.length>500||/[\r\n]/.test(subject)||body.length>16000)throw Error("NOTICE_CONTENT");
  return {subject,text:body};
}

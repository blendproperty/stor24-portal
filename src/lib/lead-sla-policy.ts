import {z} from 'zod';
export const leadSlaSchema=z.object({enabled:z.boolean(),hours:z.number().int().min(1).max(168),windows:z.array(z.object({day:z.number().int().min(0).max(6),start:z.number().int().min(0).max(1439),end:z.number().int().min(1).max(1440)}).strict().refine(v=>v.start<v.end)).min(1).max(7).refine(v=>new Set(v.map(x=>x.day)).size===v.length),holidays:z.array(z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;},'Choose an actual calendar date.')).max(100),recipients:z.array(z.object({name:z.string().trim().min(1).max(100),email:z.email().transform(v=>v.toLowerCase())}).strict()).max(10).refine(v=>new Set(v.map(x=>x.email)).size===v.length)}).strict().refine(v=>!v.enabled||v.recipients.length>0,'Choose an escalation recipient before enabling.');
export type LeadSlaPolicy=z.infer<typeof leadSlaSchema>;
export const defaultLeadSla:LeadSlaPolicy={enabled:false,hours:8,windows:[1,2,3,4,5].map(day=>({day,start:480,end:1020})),holidays:[],recipients:[]};
export function businessDeadline(start:Date,policy:LeadSlaPolicy){const p=leadSlaSchema.parse(policy);let remaining=p.hours*3600000;const cursor=new Date(start.getTime()+7200000);cursor.setUTCHours(0,0,0,0);for(let i=0;i<370;i++){const date=cursor.toISOString().slice(0,10);const window=p.windows.find(w=>w.day===cursor.getUTCDay());if(window&&!p.holidays.includes(date)){const from=Math.max(start.getTime(),cursor.getTime()-7200000+window.start*60000),to=cursor.getTime()-7200000+window.end*60000;const available=Math.max(0,to-from);if(available>=remaining)return new Date(from+remaining);remaining-=available;}cursor.setUTCDate(cursor.getUTCDate()+1);}throw Error('SLA_CALENDAR_REVIEW');}

/** Published calendar verified 5 October 2026: gov.za/about-sa/public-holidays.
 * Exceptional 4 November 2026 declaration: gov.za document, Proclamation 346 (9 September 2026).
 * Dates stay editable for exceptional closures and future calendar review. */
export const slaPublicHolidays=['2026-01-01','2026-03-21','2026-04-03','2026-04-06','2026-04-27','2026-05-01','2026-06-16','2026-08-09','2026-08-10','2026-09-24','2026-11-04','2026-12-16','2026-12-25','2026-12-26','2027-01-01','2027-03-21','2027-03-22','2027-03-26','2027-03-29','2027-04-27','2027-05-01','2027-06-16','2027-08-09','2027-09-24','2027-12-16','2027-12-25','2027-12-26','2027-12-27'];
export function slaFromStoreHours(input:unknown):LeadSlaPolicy|null{
 if(!input||typeof input!=='object'||Array.isArray(input))return null;const config=input as Record<string,unknown>;
 const minutes=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):null;
 const windows:LeadSlaPolicy['windows']=[];
 for(const [period,days] of [['Weekday',[1,2,3,4,5]],['Saturday',[6]],['Sunday',[0]]] as const){const closed=config[`office${period}Closed`];if(closed===true||closed==='true')continue;const start=minutes(config[`office${period}Start`]),end=minutes(config[`office${period}End`]);if(start===null||end===null||start>=end)return null;for(const day of days)windows.push({day,start,end});}
 const holidayClosed=config.officePublicHolidayClosed===true||config.officePublicHolidayClosed==='true';
 // Separate holiday opening windows require an explicit custom calendar, not a guessed weekday schedule.
 if(!holidayClosed)return null;
 const parsed=leadSlaSchema.safeParse({...defaultLeadSla,windows,holidays:slaPublicHolidays});return parsed.success?parsed.data:null;
}

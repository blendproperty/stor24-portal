/** Local estimate only. Posting uses the approved account billing policy. */
export function prorationPreview(rate: number, date: string) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 10_000_000 || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days) return null;
  const remaining = days - day + 1;
  return { days, remaining, amount: Math.round(Math.round(rate * 100) * remaining / days) / 100, dailyRate: rate / days };
}

export type InitialRentPolicy={mode:'ACTUAL_DAYS'|'FULL_MONTH'|'AFTER_CUTOFF_NEXT_MONTH';cutoffDay:number};
export function initialRentPreview(rate:number,date:string,policy:InitialRentPolicy){const result=prorationPreview(rate,date);if(!['ACTUAL_DAYS','FULL_MONTH','AFTER_CUTOFF_NEXT_MONTH'].includes(policy.mode)||!result||!Number.isInteger(policy.cutoffDay)||policy.cutoffDay<1||policy.cutoffDay>31)return null;const first=policy.mode==='FULL_MONTH'?Math.round(rate*100)/100:result.amount;const includeNext=policy.mode==='AFTER_CUTOFF_NEXT_MONTH'&&Number(date.slice(-2))>policy.cutoffDay;const [year,month]=date.split('-').map(Number);const nextPeriod=new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);const lines=[{period:date.slice(0,7),amount:first},...(includeNext?[{period:nextPeriod,amount:Math.round(rate*100)/100}]:[])];return {...result,lines,total:lines.reduce((n,l)=>n+Math.round(l.amount*100),0)/100,nextMonth:includeNext?nextPeriod:null};}

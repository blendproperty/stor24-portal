import { z } from "zod";
import { southAfricaDateKey } from "./south-africa-time";
type Run = { status:string; environment:string; actionDate:string; instructions:Array<{accountId:string}> };
type Settings = { enabled?:string; accountIds?:string; actionDates?:string };
/** Configuration diagnostics only: not bank/provider authority or a substitute
 * for mandate, merchant, source and durable claim checks during submission. */
export function debitTestReadiness(run:Run,settings:Settings,now=new Date()){
  const accounts=new Set((settings.accountIds??"").split(",").map(value=>value.trim()).filter(Boolean)),dates=new Set((settings.actionDates??"").split(",").map(value=>value.trim()).filter(Boolean));
  const today=southAfricaDateKey(now),validDate=z.iso.date().safeParse(run.actionDate).success;
  const missingAccounts=run.instructions.filter(row=>!accounts.has(row.accountId)).length;
  const checks=[
    {key:"stage",label:"Batch is prepared and has not been uploaded",passed:run.status==="PREPARED"},
    {key:"switch",label:"Application test-submission switch is enabled",passed:settings.enabled==="true"},
    {key:"environment",label:"Batch belongs to the sandbox environment",passed:run.environment==="sandbox"},
    {key:"future-date",label:"Collection date is valid and later than today in South Africa",passed:validDate&&run.actionDate>today},
    {key:"date-allowlist",label:"Exact collection date is in the configured test-date allowlist",passed:dates.has(run.actionDate)},
    {key:"accounts",label:"Batch includes at least one account",passed:run.instructions.length>0},
    {key:"account-allowlist",label:"Every included account is in the configured test-account allowlist",passed:run.instructions.length>0&&missingAccounts===0},
  ];
  return{checkedAt:now.toISOString(),configurationAllowsTestRequest:checks.every(check=>check.passed),checks,includedAccounts:run.instructions.length,accountsMissingAllowlist:missingAccounts,liveSubmissionSupported:false as const,financialReceipt:false as const};
}
export type DebitTestReadiness=ReturnType<typeof debitTestReadiness>;

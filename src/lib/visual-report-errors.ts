import { authErrorResponse } from "./auth-guards";
import { dlpPrivateHeaders } from "./dlp-policy";
const errors:Record<string,[number,string]>={
  REPORT_REQUEST_LIMIT:[413,"The report request is too large."],
  REPORT_CSV_INVALID:[422,"The CSV must have unique column headers, valid quoting and consistent row lengths."],
  REPORT_HISTORY_MAPPING:[422,"Map Source record ID and each selected field to a source CSV column."],
  REPORT_HISTORY_CURRENCY:[422,"Map an explicit three-letter currency column for financial history."],
  REPORT_HISTORY_DUPLICATE:[422,"Source record IDs must be present and unique within this extract."],
  REPORT_HISTORY_FIELD:[422,"A mapped field has an invalid value or format. Use ISO dates, numeric quantities and money with at most two decimal places."],
  REPORT_LIMIT:[422,"This report exceeds 5,000 source records or the safe file size. Select a store and a narrower period."],
  REPORT_NOT_FOUND:[404,"This saved report is unavailable."],
  REPORT_CONFLICT:[409,"This report changed or is no longer editable. Reload saved reports before retrying."],
  REPORT_SHARING_FORBIDDEN:[403,"Only the Organisation owner may publish report definitions for the organisation."],
  REPORT_SAVED_LIMIT:[422,"You have reached the limit of 100 saved reports. Archive an unused report first."],
  REPORT_SCHEDULE_EXISTS:[409,"This report already has an active schedule. Pause it before creating another."],
  REPORT_SCHEDULER_UNAVAILABLE:[503,"Automatic reporting is not configured yet. Your saved report remains available for manual runs."],
  REPORT_STORAGE_UNAVAILABLE:[503,"Protected report storage is unavailable. Contact your administrator."],
  REPORT_EXPIRED:[410,"This report snapshot has expired. Run the saved report again for current data."],
  PERSONAL_EXPORT_FORBIDDEN:[403,"Personal-data downloads require Organisation owner authorization. Remove personal fields or ask your administrator."],
  DLP_EXPORT_BLOCKED:[422,"Data protection blocked this report. Narrow your selection or contact your administrator."],
  FACILITY_FORBIDDEN:[403,"You do not have report access to that store."],
  INVALID_REPORT_AMOUNT:[422,"A recorded amount cannot be safely totaled. Review the source records."],
};
export function visualReportErrorResponse(error:unknown) {
  const code=error instanceof Error?error.message:"";const result=errors[code];
  if(result)return Response.json({error:{code,message:result[1]}},{status:result[0],headers:dlpPrivateHeaders});
  if(error instanceof SyntaxError)return Response.json({error:{code:"VALIDATION_ERROR",message:"Check the report request."}},{status:422,headers:dlpPrivateHeaders});
  const response=authErrorResponse(error);for(const [key,value] of Object.entries(dlpPrivateHeaders))response.headers.set(key,value);return response;
}

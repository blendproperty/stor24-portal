import type { EnquiryLocationRecord } from "@/lib/enquiry-location";

export function enquiryLocationFromForm(form: FormData) {
  return Object.fromEntries(["city", "province", "postalCode", "country"].map(key => [key, String(form.get(`enquiryLocation.${key}`) ?? "")]));
}

export function EnquiryLocationFields({ value, disabled = false }: { value?: EnquiryLocationRecord | null; disabled?: boolean }) {
  return <fieldset disabled={disabled}><legend>Where is this enquiry coming from? (optional)</legend><p className="leads-caption">Record only what the customer tells you. This helps us understand enquiry areas and does not change their billing address. Leave unknown fields blank.</p><div className="leads-form-row">
    <label>Enquiry city / town<input name="enquiryLocation.city" maxLength={100} defaultValue={value?.city ?? ""}/></label>
    <label>Enquiry province / region<input name="enquiryLocation.province" maxLength={100} defaultValue={value?.province ?? ""}/></label>
    <label>Enquiry postal code<input name="enquiryLocation.postalCode" maxLength={16} defaultValue={value?.postalCode ?? ""}/></label>
    <label>Enquiry country<input name="enquiryLocation.country" maxLength={100} defaultValue={value?.country ?? ""}/></label>
  </div>{value && <p className="leads-caption">{value.source === "PUBLIC_SELF_REPORTED" ? "Customer supplied" : "Staff recorded"} · {value.capturedAt.slice(0, 10)} · unverified enquiry origin</p>}</fieldset>;
}

import { createHash } from "node:crypto";
import { privacyNoticeVersion, privacySections } from "./privacy-notice";

export function bookingPreferenceRecord(input: { email?: boolean; sms?: boolean; phone?: boolean; whatsapp?: boolean }, noticeVersion: string | undefined, source: string, now = new Date()) {
  const presented = noticeVersion === privacyNoticeVersion;
  return {
    email: input.email === true, sms: input.sms === true,
    phone: input.phone === true, whatsapp: input.whatsapp === true,
    purpose: "OPTIONAL_BOOKING_UPDATES", marketing: false,
    noticeVersion: presented ? privacyNoticeVersion : null,
    noticeSha256: presented ? createHash("sha256").update(JSON.stringify(privacySections)).digest("hex") : null,
    recordedAt: now.toISOString(), source,
  };
}

// UUID digit runs can resemble payment cards after hyphen normalization. Keep
// successful-send fixtures unique without accidentally exercising the DLP hold.
export function phoneNoticeAccountNumber(key: string) {
  return `PHONE-CI-${key.replace(/[0-9]/g, digit => String.fromCharCode(103 + Number(digit)))}`;
}

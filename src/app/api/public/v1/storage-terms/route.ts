import { STORAGE_TERMS, STORAGE_TERMS_STATUS, STORAGE_TERMS_VERSION, storageTermsText } from "@/lib/storage-terms";
import { publicApiAuthorized } from "@/lib/public-booking-contract";

export async function GET(request: Request) {
  if (!publicApiAuthorized(request)) return Response.json({ error: { message: "Request rejected." } }, { status: 401 });
  return Response.json({ data: { version: STORAGE_TERMS_VERSION, status: STORAGE_TERMS_STATUS, sections: STORAGE_TERMS, text: storageTermsText() } }, { headers: { "cache-control": "no-store" } });
}

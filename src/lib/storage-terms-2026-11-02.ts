import source from "../../docs/legal/2026-11-02/confirmed-word-terms.json";

// Candidate only. The active edition stays in storage-terms.ts until the booking
// schedule and checkout can honour the confirmed document's deposit requirement.
export const STORAGE_TERMS_VERSION = "storage-terms-2026-11-02-word";
export const STORAGE_TERMS_STATUS = "Working draft for legal review - not legal-approved";
export const STORAGE_TERMS = source.sections;
export const STORAGE_TERMS_SOURCE = {
  filename: source.sourceFilename,
  sha256: source.sourceSha256,
  heading: source.sourceHeading,
  edition: source.sourceEdition,
  confirmedOn: source.sourceConfirmedOn,
};

export function storageTermsText() {
  return [source.sourceHeading, `Terms version: ${STORAGE_TERMS_VERSION}`, source.sourceEdition,
    STORAGE_TERMS_STATUS, "", ...STORAGE_TERMS.flatMap(section => [section.title, section.body, ""])].join("\n");
}

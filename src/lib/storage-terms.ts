import type { LeaseClauseContext } from "./lease-agreement-content";
import { STORAGE_TERMS_VERSION, renderReviewLeaseDocument } from "./storage-terms-2026-11-02";
export { STORAGE_TERMS, STORAGE_TERMS_INTRODUCTION, STORAGE_TERMS_STATUS, STORAGE_TERMS_VERSION, storageTermsText, buildReviewLeaseClauses, renderReviewLeaseDocument } from "./storage-terms-2026-11-02";
export { STORAGE_TERMS_VERSION as PREVIOUS_STORAGE_TERMS_VERSION } from "./storage-terms-2026-09-10";
import { STORAGE_TERMS_VERSION as previousVersion, renderReviewLeaseDocument as renderPreviousEdition } from "./storage-terms-2026-09-10";
import { STORAGE_TERMS_VERSION as september22Version, renderReviewLeaseDocument as renderSeptember22Edition } from "./storage-terms-2026-09-22";
import { STORAGE_TERMS_VERSION as octoberVersion, renderReviewLeaseDocument as renderOctoberEdition } from "./storage-terms-2026-10-20";

export function requiresFullTermsAcceptance(version: string) {
  return [STORAGE_TERMS_VERSION, previousVersion, september22Version, octoberVersion].includes(version);
}
export function renderStorageTermsEdition(ctx: LeaseClauseContext, version: string): string | null {
  if (version === STORAGE_TERMS_VERSION) return renderReviewLeaseDocument(ctx);
  if (version === octoberVersion) return renderOctoberEdition(ctx);
  if (version === september22Version) return renderSeptember22Edition(ctx);
  if (version === previousVersion) return renderPreviousEdition(ctx);
  return null;
}

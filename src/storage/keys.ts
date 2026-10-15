/**
 * Per-bundle storage keys shared by the boot chunk (auto-open engine,
 * registration) and the drawer controller. Lives outside src/ui so the boot
 * path never pulls the drawer in.
 */
import { AVAFLI_CONSTANTS } from '../types';

/** Non-PII "email submitted" flag key — shared with the auto-open engine. */
export function emailSubmittedStorageKey(bundleId: string): string {
  return `${AVAFLI_CONSTANTS.STORAGE_KEYS.EMAIL_SUBMITTED}_${bundleId}`;
}

export function adoptionCodeSentAtStorageKey(bundleId: string): string {
  return `${AVAFLI_CONSTANTS.STORAGE_KEYS.ADOPTION_CODE_SENT_AT}_${bundleId}`;
}

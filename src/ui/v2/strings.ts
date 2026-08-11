/**
 * ALL user-facing V2 error/notice copy in ONE place — Scott's "User Message
 * (UI)" column from the Master Field List. UI code must never render raw
 * backend error text; it maps failures to one of these fixed strings. Keeping
 * every string here gives copy review (and future localization) a single
 * surface to sweep.
 */
export const WINRV2Strings = {
  // ─── Email capture ───
  /** Inline under the email field once touched / on a submit attempt. */
  emailInvalid: 'Please enter a valid email address.',
  /** The email submit itself failed (transport/backend) — user stays on capture. */
  emailSubmitFailed: 'Something went wrong sending your email. Please try again.',

  // ─── Verification-code screen (cross-device adoption OTP) ───
  codeExpired: "That code expired. Tap 'Send a new code' to get a fresh one.",
  codeTooManyAttempts: 'Too many attempts. Request a new code.',
  codeIncorrect: "That code didn't match. Check the email and try again.",
  /** RESEND failed — shown in the code-error slot; the code screen stays up. */
  codeResendFailed: "Couldn't send a new code. Check your connection and try again.",

  // ─── Soft email verification (persistent dashboard chip → code screen) ───
  /** The persistent, non-blocking chip on the streak dashboard. */
  verifyEmailChip: 'Verify your email',
  /** Header on the reused 6-digit code screen for email verification. */
  verifyEmailTitle: 'Verify your email',
  /** Subtitle on that screen. */
  verifyEmailSubtitle:
    "Enter the 6-digit code we sent to your inbox so you're eligible to win.",
  /** Transient dashboard confirmation after a successful verify. */
  emailVerified: 'Email verified ✓',

  // ─── Winner claim form, step 1 ───
  firstNameInvalid: 'Please enter a valid first name.',
  lastNameInvalid: 'Please enter a valid last name.',
  phoneInvalid: 'Please enter a valid 10-digit mobile number.',
  /** Transport failure on the prize-claim submit — inline on the review page. */
  claimSubmitFailed: 'Something went wrong. Please check your connection and try again.',

  // ─── Dashboard notices ───
  /**
   * Backend rejected the claim as already-claimed when LOCAL state thought
   * today was unclaimed (cross-device race). Transient — never shown on a
   * normal open where claimedToday was already known.
   */
  alreadyEnteredToday: "You've already entered today. Come back tomorrow to keep your streak going!",
  /** Auto-claim transport failure — dashboard shows UNCLAIMED plus this retryable notice. */
  claimRecordFailed: "We couldn't record today's entry. Check your connection and try again.",

  // ─── Privacy choices (RTD opt-out, how-it-works screen) ───
  /** Muted entry-point link at the bottom of the how-it-works screen. */
  privacyChoices: 'Privacy choices',
  optOutTitle: 'Delete my data & stop participating',
  optOutBody:
    'This permanently deletes your WINR data, ends your giveaway participation, and cannot be undone. You can also email info@avafli.com.',
  optOutConfirm: 'DELETE MY DATA',
  optOutCancel: 'Cancel',
  /** Brief success state shown before the experience dismisses itself. */
  optOutSuccess: 'Your data has been deleted.',
  /**
   * The opt-out call failed — the confirmation stays up and can retry. We
   * never pretend the deletion succeeded.
   */
  optOutFailed: 'Something went wrong. Please check your connection and try again.',

  // ─── Dedicated failure states ───
  geoBlockedTitle: 'Not available in your location',
  geoBlockedBody:
    'This promotion is only available to users located in the United States. Please check your location settings or try again from an eligible location.',
  sessionExpired: 'Your session has expired. Please try again.',
  retry: 'RETRY',
} as const;

/**
 * Whether a backend rejection is the geo-fence speaking. Matches BOTH shapes
 * thrown by the backend's `enforceGeoFence` (functions/src/gatekeeper.ts):
 *  - GEO_UNVERIFIED_MESSAGE: "We couldn't verify your location. This
 *    promotion is only available in the United States."
 *  - GEO_NON_US_MESSAGE: "This promotion is only available to users located
 *    in one of the 50 United States or Washington, D.C."
 * The onCall error surfaces as its message string (network/client.ts unwraps
 * `{ error: { message } }`), so message matching is the available signal.
 */
export function isGeoBlockedError(message: string): boolean {
  return /promotion is only available|verify your location/i.test(message);
}

/**
 * ALL user-facing V2 error/notice copy in ONE place — Scott's "User Message
 * (UI)" column from the Master Field List. UI code must never render raw
 * backend error text; it maps failures to one of these fixed strings. Keeping
 * every string here gives copy review (and future localization) a single
 * surface to sweep.
 */
export const AvafliV2Strings = {
  // ─── Email capture ───
  /** Inline under the email field once touched / on a submit attempt. */
  emailInvalid: 'Please enter a valid email address.',
  /** The email submit itself failed (transport/backend) — user stays on capture. */
  emailSubmitFailed: 'Something went wrong sending your email. Please try again.',

  // ─── Verification-code screen (cross-device adoption OTP) ───
  codeExpired: "That code expired. Tap 'Send a new code' to get a fresh one.",
  codeTooManyAttempts: 'Too many attempts. Request a new code.',
  /** The old code is dead (expired / attempts used up) and a fresh one was just mailed. */
  codeFreshSent: "That code can't be used anymore — we just sent you a fresh one. Check your email.",
  codeIncorrect: "That code didn't match. Check the email and try again.",
  /** RESEND failed — shown in the code-error slot; the code screen stays up. */
  codeResendFailed: "Couldn't send a new code. Check your connection and try again.",
  /**
   * Adoption RE-ENTRY (2.9): the register response reported
   * `adoptionPending: true` — this device typed an email that matched an
   * existing account but never finished the 6-digit code. The drawer routes
   * straight to the code screen (after `restageAdoption` re-sends a fresh
   * code) with this subtitle variant.
   */
  adoptionReentrySubtitle:
    'Pick up where you left off — enter the 6-digit code we just sent to your email to reconnect your streak.',

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

  // ─── Prize-claim email-ownership step (3.2.0) ───
  // The six-digit code a winner enters before the claim form opens. Plain
  // English only: "code" / "verification code". Two messages on this step
  // are the SERVER'S own sentence, by contract written for the winner: the
  // "we sent you a new one" notice, and why a claim is no longer available.
  claimCodeTitle: 'CHECK YOUR EMAIL',
  /** `{maskedEmail}` is the server-masked address (the SDK never holds the raw one). */
  claimCodeSubtitle: 'Enter the 6-digit code we sent to {maskedEmail}',
  /** Same line when the block carries no masked address. */
  claimCodeSubtitleNoEmail: 'Enter the 6-digit code we sent to your email',
  /** Small inline status while the opening send is in flight. */
  claimCodeSending: 'Sending your code…',
  /** Inline status once a NEW code went out (never shown for a re-used live code). */
  claimCodeSent: 'Code sent',
  /** The send failed — inline, next to a Retry action; the field stays usable. */
  claimCodeSendFailed: "We couldn't send your code just now. Please try again in a minute.",
  claimCodeRetry: 'Try again',
  claimCodeResend: 'Send a new code',
  /** The resend action while it cools down; `{time}` is m:ss. */
  claimCodeResendIn: 'Send a new code in {time}',
  /** Help line under the code screen; the address is a mailto link. */
  claimCodeHelp: "Can't get to this email? Contact {email}",
  claimHelpEmail: 'info@avafli.com',
  /** Wrong code; `{attemptsRemaining}` comes from the server. */
  claimCodeMismatch: "That code didn't match. {attemptsRemaining} tries left.",
  claimCodeMismatchOne: "That code didn't match. 1 try left.",
  /** "Send a new code" tapped inside the server's 60-second cooldown. */
  claimCodeCooldown: 'Please wait a moment before requesting another code.',
  /** Five codes in an hour — the resend countdown follows the server's retry time. */
  claimCodeSendLimit:
    "You've requested several codes. Please try again in a little while, or contact info@avafli.com.",
  /** The request never reached the server — what they typed is kept. */
  claimCodeNetwork: "We couldn't reach the server. Check your connection and try again.",
  /** No address on file for the winning account — a code cannot be sent. */
  claimCodeNoEmail:
    "We don't have an email on file for this account. Contact info@avafli.com to claim your prize.",
  /** Fallback when the server's claim-state rejection carries no message. */
  claimUnavailable: 'This prize claim is no longer available.',

  // ─── Dashboard notices ───
  /**
   * Backend rejected the claim as already-claimed when LOCAL state thought
   * today was unclaimed (cross-device race). Transient — never shown on a
   * normal open where claimedToday was already known.
   */
  alreadyEnteredToday: "You've already entered today. Come back tomorrow to keep your streak going!",
  /** Auto-claim transport failure — dashboard shows UNCLAIMED plus this retryable notice. */
  claimRecordFailed: "We couldn't record today's entry. Check your connection and try again.",

  // ─── Winner share step (post-submit, 2.9) ───
  /**
   * Toast after copying the share line to the clipboard — the honest
   * fallback for platforms with no web prefill API (Instagram, Snapchat,
   * TikTok) when the Web Share API is unavailable.
   */
  shareCopied: 'Copied! Paste it in your post',

  // ─── In-experience legal overlay (2.9.5) ───
  /** Shown when the legal iframe never fires `load` (publisher CSP block). */
  legalOverlayLoadFailed: "This page couldn't be loaded here.",
  /** The escape-hatch link under {@link legalOverlayLoadFailed}. */
  legalOverlayOpenInTab: 'Open in new tab',

  // ─── RTD opt-out (delete-my-data confirmation) ───
  optOutTitle: 'Delete my data & stop participating',
  optOutBody:
    'This permanently erases your information and ends your participation. Entries and streaks are forfeited and cannot be restored. You can join again as a new participant after 24 hours.',
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

/** The claim code screen's subtitle for this (server-masked) address. */
export function claimCodeSubtitle(maskedEmail?: string | null): string {
  const masked = maskedEmail?.trim();
  return masked
    ? AvafliV2Strings.claimCodeSubtitle.replace('{maskedEmail}', masked)
    : AvafliV2Strings.claimCodeSubtitleNoEmail;
}

/** "That code didn't match. N tries left." — generic copy when N is unknown. */
export function claimCodeMismatchMessage(attemptsRemaining: unknown): string {
  if (typeof attemptsRemaining !== 'number' || !Number.isFinite(attemptsRemaining)) {
    return AvafliV2Strings.codeIncorrect;
  }
  const left = Math.max(0, Math.floor(attemptsRemaining));
  return left === 1
    ? AvafliV2Strings.claimCodeMismatchOne
    : AvafliV2Strings.claimCodeMismatch.replace('{attemptsRemaining}', String(left));
}

/** The resend action's label: plain when ready, with m:ss while cooling down. */
export function claimCodeResendLabel(secondsLeft: number): string {
  if (secondsLeft <= 0) return AvafliV2Strings.claimCodeResend;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');
  return AvafliV2Strings.claimCodeResendIn.replace('{time}', `${minutes}:${seconds}`);
}

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

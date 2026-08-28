import {
  ClaimDailyEntriesResponse,
  DailyEntryGrant,
  GetActiveGiveawayResponse,
  Giveaway,
  PrizeClaimBlock,
  SDKConfig,
  StreakState,
  SubmitEmailRequest,
  SubmitEmailResponse,
  AvafliError,
  AvafliErrorCode,
  AVAFLI_CONSTANTS,
} from '../../types';
import { CLAIM_COUNTRY, PrizeClaimForm, emptyClaimForm, isClaimFormValid } from './claim';
import { AvafliV2Strings, isGeoBlockedError } from './strings';
import { AvafliAPI } from '../../network/api';
import { LocalStorageProvider } from '../../storage/local-storage';
import { logger } from '../../services/logger';
import { analyticsAdapter } from '../../services/analytics';
import { prewarmImage } from './effects';
import { ladderEntries } from './v2-theme';

/**
 * V2 experience state machine — ported from iOS WINRExperienceViewModel.
 *
 * Flow: loading → (emailCapture | dashboard) → auto-claim on open → the
 * celebration is ALWAYS the dashboard's FIRST VISIBLE FRAME (there is no
 * celebration modal):
 * Day 1: the previous screen (email capture with its CTA spinner, or the
 * loading state) HOLDS while the claim is awaited, then the dashboard mounts
 * with the celebration staged straight from the claim response ("YOU'RE IN!"
 * toast, 0→N count-up, tile burst) /
 * Day 2+ (pre-claim streak >= 2): a PREDICTED grant (ladder math over the
 * pre-claim status response) is staged before entering the dashboard, the
 * in-place celebration (tile check + confetti + totals advance) fires on
 * first mount, and the real claim runs in the background, reconciling
 * totals/streak silently when it returns (no second celebration; failures
 * settle back to server truth quietly) /
 * silent claimed-state on "Already claimed" (with a ONE-SHOT re-sync so
 * cached totals catch up when another device claimed between the status
 * fetch and our claim).
 */

export type V2State =
  | { kind: 'loading' }
  | { kind: 'empty' } // no active giveaway / opted out / fatal error
  | { kind: 'emailCapture' }
  /**
   * The 6-digit adoption-code screen. Normally reached from the capture flow
   * (email + consent captured this session). The RE-ENTRY variant (2.9,
   * `reentry: true`) is reached when the register response reported
   * `adoptionPending` — a previous session typed the email but never
   * finished the code, so the raw address is no longer in memory (PII is
   * never persisted): `email`/`consent` are absent, resends go through
   * `restageAdoption`, and the subtitle reads "Pick up where you left off".
   */
  | { kind: 'codeEntry'; email?: string; consent?: EmailCaptureConsent; reentry?: boolean }
  /**
   * Soft email-verification screen — the SAME 6-digit code component as
   * `codeEntry`, reached by tapping the persistent "Verify your email" chip on
   * the dashboard. Fully dismissible (a back/cancel returns to the dashboard);
   * it gates nothing.
   */
  | { kind: 'emailVerify' }
  | { kind: 'dashboard' }
  | { kind: 'howItWorks' }
  /** Backend geo-fence rejected this user — dedicated screen, never 'empty'. */
  | { kind: 'geoBlocked' }
  /** Token refresh failed (AuthenticationRequired) — dedicated RETRY screen. */
  | { kind: 'sessionExpired' }
  /**
   * This person is the drawn winner and hasn't submitted their claim yet —
   * the drawer shows the winner splash → claim form → confirmation flow
   * instead of the dashboard. Takes precedence on open (even before the
   * email-capture gate — the claim is keyed to the account server-side).
   */
  | { kind: 'winnerClaim'; claim: PrizeClaimBlock };

/**
 * Sub-screen of the winner claim flow (`state.kind === 'winnerClaim'`).
 * 2.9 order: splash → form (3 steps + review/submit) → share → confirmation.
 * The SHARE step comes AFTER the submit and never blocks — the claim is
 * already recorded server-side, so closing/skipping it changes nothing.
 */
export type WinnerClaimStep =
  | { kind: 'splash' }
  | { kind: 'form' }
  | { kind: 'share'; claimNumber: string; submittedAt: string }
  | { kind: 'confirmation'; claimNumber: string; submittedAt: string };

/** Which legal document the in-experience overlay shows. */
export type LegalDoc = 'rules' | 'privacy';

/**
 * Appends `app=1` to a URL — the flag that makes winrmedia.com/sdk/privacy
 * render its in-experience "Delete my data" section (parallel build on the
 * website side). URL-API based so a target that already carries a query
 * string extends correctly instead of getting a second `?`.
 */
export function withAppParam(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('app', '1');
    return u.toString();
  } catch {
    return url;
  }
}

export interface V2ControllerDeps {
  api: AvafliAPI;
  storage: LocalStorageProvider;
  bundleId: string;
  /** Cross-device adoption path (Avafli.submitEmailAndAdopt). */
  submitEmailAndAdopt: (request: SubmitEmailRequest) => Promise<SubmitEmailResponse>;
  /** Whether the registration handshake produced a user_uid. */
  hasRegisteredUuid: () => boolean;
  /** Host-app-provided identity — prefills the winner claim form. */
  userPrefill?: { firstName?: string; lastName?: string; phone?: string; email?: string };
  /** Completes a verification-gated adoption (6-digit email OTP). */
  verifyAdoptionCode?: (request: { code: string }) => Promise<unknown>;
  /**
   * Confirms a soft email verification (6-digit code for a newly-typed email).
   * Same request/response envelope as {@link verifyAdoptionCode}; returns
   * `{ verified: true }` on success, throws expired/attempts/mismatch on
   * failure.
   */
  confirmEmailVerification?: (request: { code: string }) => Promise<unknown>;
  /** Re-sends the soft email-verification code. Returns `{ sent: boolean }`. */
  resendEmailVerification?: () => Promise<unknown>;
  /**
   * Adoption RE-ENTRY (2.9): the register response reported
   * `adoptionPending: true` — an adoption was started (email typed, code
   * mailed) but never completed on this device.
   */
  adoptionPending?: boolean;
  /**
   * Re-stages a pending adoption: POST /restageAdoption (authed), returns
   * `{ sent }` after mailing a fresh 6-digit code. Called before routing the
   * drawer-open to the code screen, and by "Send a new code" in re-entry mode.
   */
  restageAdoption?: () => Promise<unknown>;
  /**
   * The pending adoption was completed (code verified) — lets the SDK clear
   * its cached `adoptionPending` flag so later drawer-opens don't re-stage.
   */
  onAdoptionResolved?: () => void;
  /**
   * Attaches the story typed on the POST-submit share step to the already
   * submitted claim (2.9 contract addendum): POST /attachClaimStory (authed),
   * `{ story }` → `{ saved }`. Fire-and-forget from the controller's side —
   * a failure never blocks or surfaces (the claim is already recorded).
   */
  attachClaimStory?: (request: { story: string }) => Promise<unknown>;
  /**
   * Performs the RTD opt-out (the in-experience "Delete my data" flow — the
   * privacy page inside the legal overlay bridges into the destructive
   * confirmation). MUST reject on failure — unlike the public
   * `Avafli.optOut()`, the in-experience flow shows an honest error instead of
   * pretending the deletion succeeded (wired to `Avafli.optOutFromExperience`).
   */
  optOut?: () => Promise<void>;
  /** Warm-start data cached by Avafli from device registration. */
  cachedGiveaway?: Giveaway | null;
  cachedSdkConfig?: SDKConfig | null;
  /**
   * Backend "claimed today" as of device registration — the warm-start truth
   * the cache-first render paints with (see {@link
   * V2ExperienceController.hydrateFromCache}).
   */
  cachedClaimedToday?: boolean;
  /** Lets Avafli keep its instance caches (giveaway, claim state, RTD) in sync. */
  onGiveawayRefreshed?: (response: GetActiveGiveawayResponse) => void;
  /**
   * Resolves the effective SDK config (server overrides merged over client
   * branding). Called after each giveaway refresh.
   */
  resolveSdkConfig?: () => SDKConfig;
}

/**
 * The capture screen's two consent checkboxes, as the user left them. Both
 * travel to the backend on submit; only {@link ageConfirmed} gates the CTA.
 */
export interface EmailCaptureConsent {
  /** "I confirm I am 18 years of age or older" — required to submit. */
  ageConfirmed: boolean;
  /**
   * Consent for the publisher to send MARKETING email — pre-checked, and
   * NEVER blocks entry. It does not govern winner contact: if this person is
   * drawn, they are contacted either way (operational necessity).
   */
  marketingConsent: boolean;
}

/**
 * Fallback copy when the server supplies no `emailConsentText` override. The
 * backend normally sends a publisher-named string ("I agree to receive
 * marketing emails from {PublisherName}"); the SDK never interpolates a
 * publisher name itself.
 */
export const DEFAULT_MARKETING_CONSENT_TEXT = 'I agree to receive marketing emails from this app';

/** Non-PII "email submitted" flag key — shared with the auto-open engine. */
export function emailSubmittedStorageKey(bundleId: string): string {
  return `${AVAFLI_CONSTANTS.STORAGE_KEYS.EMAIL_SUBMITTED}_${bundleId}`;
}

/**
 * Whether a persisted `lastClaimedDate` (JSON round-trips to a string) falls
 * on today's LOCAL calendar day — the cache-first render's fallback for
 * "already claimed" when the registration handshake hasn't reported one.
 */
function isToday(value: Date | string | undefined): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export class V2ExperienceController {
  public state: V2State = { kind: 'loading' };

  public giveaway: Giveaway | null;
  public sdkConfig: SDKConfig | null;
  public claimedToday = false;
  public streakDay = 1;
  public totalEntries = 0;
  public isSubmittingEmail = false;

  /**
   * Soft email-verification state. True ONLY when the backend explicitly
   * reported `emailVerified === false` (a brand-new, unconfirmed email) — the
   * dashboard shows the persistent "Verify your email" chip while it holds.
   * NEVER gates daily play, auto-claim, or streak; it purely drives the UI
   * affordance (draw eligibility is enforced server-side).
   */
  public unverified = false;

  // ─── User-facing failure surfaces (Master Field List "User Message (UI)") ───

  /**
   * The email submit itself failed — rendered inline on the capture screen
   * (below the CTA) so the user can retry instead of being silently marched
   * forward as if the submit succeeded.
   */
  public emailSubmitError: string | null = null;

  /**
   * Transient dashboard notice ("You've already entered today…"). Set ONLY
   * when a claim attempt was rejected as already-claimed while local state
   * thought today was unclaimed (the cross-device race) — never on a normal
   * open where claimedToday was already known. The dashboard render consumes
   * it and auto-dismisses after a few seconds.
   */
  public dashboardNotice: string | null = null;

  /**
   * The auto-claim failed in transit — the dashboard shows UNCLAIMED plus a
   * persistent, retryable notice instead of fabricating success or failing
   * silently. Cleared by a successful retry.
   */
  public claimFailedNotice = false;

  // ─── In-place reveal flow (every day — there is no celebration modal) ───
  //
  // The celebration is the dashboard's first visible frame.
  // Day 2+ (pre-claim streak >= 2): a PREDICTED grant is staged straight
  // from the pre-claim status response (predicted entries = the ladder value
  // for the streak day being claimed today), the reveal fires on first
  // mount, and the real claim runs in the BACKGROUND — its response
  // reconciles the totals/streak silently (no second celebration).
  // Day 1: the claim is AWAITED while the previous screen holds, and the
  // grant is staged directly from the claim response (no prediction needed).
  // The pill reads "GOT IT" the whole time — there is no claim click.

  /** The grant staged for the auto-reveal (null when nothing is pending). */
  public pendingRevealGrant: { baseEntries: number; bonusEntries: number } | null = null;
  /** Whether the in-place celebration has played. */
  public claimRevealed = false;
  /** Total entries as of before today's claim, for the pre-reveal frame. */
  public preClaimTotalEntries: number | null = null;
  /** Pre-claim server numbers, restored if the background claim fails. */
  private preRevealSnapshot: { streakDay: number; totalEntries: number } | null = null;

  /**
   * Delay between the dashboard mounting and the celebration firing — one
   * short beat so the flip reads as motion, but the celebration is
   * effectively the first thing the user sees (no pinned pre-claim flash).
   */
  public static readonly AUTO_REVEAL_DELAY_MS = 150;

  /**
   * In-place celebration hook, registered by the dashboard render — the
   * reveal must mutate the already-visible dashboard (draw-on check, rAF
   * count-up), not re-render it. Falls back to a bare revealClaim() when no
   * dashboard has registered (e.g. headless usage).
   */
  public onAutoReveal?: () => void;

  /**
   * Silent reconcile hook, registered by the dashboard render: the background
   * claim (or its failure re-sync) landed, and the on-screen totals/streak
   * should be updated in place — quietly, with no second celebration.
   */
  public onRevealReconcile?: () => void;

  private autoRevealTimer: ReturnType<typeof setTimeout> | null = null;

  public revealClaim(): void {
    if (!this.pendingRevealGrant || this.claimRevealed) return;
    this.claimRevealed = true;
  }

  /**
   * Arms the automatic celebration — called when the dashboard state is
   * entered with a staged (predicted) grant. Re-arming resets the timer; the
   * guards here and in revealClaim() make a double-fire harmless.
   */
  public scheduleAutoReveal(): void {
    if (!this.pendingRevealGrant || this.claimRevealed) return;
    this.cancelAutoReveal();
    this.autoRevealTimer = setTimeout(() => {
      this.autoRevealTimer = null;
      if (!this.pendingRevealGrant || this.claimRevealed) return;
      if (this.onAutoReveal) this.onAutoReveal();
      else this.revealClaim();
    }, V2ExperienceController.AUTO_REVEAL_DELAY_MS);
  }

  /** Disarms a pending auto-reveal (dismissal before it fires must no-op). */
  public cancelAutoReveal(): void {
    if (this.autoRevealTimer !== null) {
      clearTimeout(this.autoRevealTimer);
      this.autoRevealTimer = null;
    }
  }

  // ─── Winner prize claim (ported from iOS WINRExperienceViewModel) ───

  /** Which screen of the winner claim flow is showing. */
  public winnerClaimStep: WinnerClaimStep = { kind: 'splash' };
  /** Spinner state for the claim form's SUBMIT pill. */
  public isSubmittingClaim = false;
  /**
   * Transport-level submit failure surfaced inline on the form ("Not the
   * winner"/"Already submitted" instead fall back to the dashboard silently).
   */
  public claimSubmitError: string | null = null;
  /** The submitted form, kept for the confirmation screen's winner card. */
  public submittedClaimForm: PrizeClaimForm | null = null;

  /**
   * The story typed on the POST-submit share step (2.9). Held here — not on
   * the share screen — so ANY exit path (DONE, the X, backdrop, Escape) can
   * flush it to the backend via {@link flushClaimStory}: a typed story is
   * never lost. Reset when a fresh share step is entered.
   */
  public claimStoryDraft = '';
  /** One-shot guard so DONE-then-dismiss can't double-send the story. */
  private claimStoryFlushed = false;

  /**
   * Best-effort attach of the typed story to the already-submitted claim:
   * fire-and-forget with ONE retry, and a failure never blocks or surfaces —
   * the claim is already recorded server-side. No-op when nothing was typed
   * or the story was already sent.
   */
  public flushClaimStory(): void {
    if (this.claimStoryFlushed) return;
    const story = this.claimStoryDraft.trim();
    const send = this.deps.attachClaimStory;
    if (!story || !send) return;
    this.claimStoryFlushed = true;
    void send({ story })
      .catch(() => send({ story })) // one retry
      .catch((error) =>
        logger.debug('attachClaimStory failed after retry (non-blocking):', error)
      );
  }
  /**
   * Set after a "Not the winner"/"Already submitted" rejection so the next
   * load skips the winner flow and lands on the normal dashboard.
   */
  private suppressWinnerClaim = false;

  /** Prefill for the claim form (host-app-provided identity). */
  public get claimFormPrefill(): PrizeClaimForm {
    return {
      ...emptyClaimForm(),
      firstName: this.deps.userPrefill?.firstName ?? '',
      lastName: this.deps.userPrefill?.lastName ?? '',
      phone: this.deps.userPrefill?.phone ?? '',
    };
  }

  /** Re-render hook (root view). */
  public onChange?: (state: V2State) => void;
  /** X buttons / GOT IT on the dashboard → close the whole experience. */
  public onDismissRequest?: () => void;
  /** A claim succeeded (present()'s completion contract). */
  public onComplete?: (grant: DailyEntryGrant) => void;
  public onError?: (error: AvafliError) => void;

  private previousState: V2State | null = null;
  /** One-shot guard for the "already claimed on another device" re-sync. */
  private didResyncAfterAlreadyClaimed = false;
  private isClaiming = false;
  /** One-shot guard so a reload after verification doesn't re-stage adoption. */
  private adoptionReentryStaged = false;

  constructor(private deps: V2ControllerDeps) {
    this.giveaway = deps.cachedGiveaway ?? null;
    this.sdkConfig = deps.cachedSdkConfig ?? null;
  }

  // ─── Derived display values ───

  public get visitMode(): boolean {
    return this.giveaway?.streakMode === 'visit';
  }

  /** The effective reward ladder (giveaway config, else SDK defaults). */
  public get ladder(): number[] {
    const ladder = this.giveaway?.streakLadder;
    if (ladder && ladder.length > 0) return ladder;
    return [...AVAFLI_CONSTANTS.DEFAULT_STREAK_LADDER];
  }

  public ladderValue(day: number): number {
    return ladderEntries(day, this.ladder, this.giveaway?.milestones);
  }

  /** Tomorrow's reward, for the celebration modal + come-back messaging. */
  public get nextEntries(): number {
    return this.ladderValue(this.streakDay + 1);
  }

  public get rulesUrl(): string | undefined {
    return this.giveaway?.rulesUrl || this.sdkConfig?.rulesUrl;
  }

  /**
   * Publisher share link for the winner share step (2.9). Optional on the
   * wire — absent from production backends until they emit it.
   */
  public get shareUrl(): string | undefined {
    return this.sdkConfig?.shareUrl;
  }

  /**
   * Publisher display name for user-facing legal copy (2.9.4: the review
   * screen's likeness consent). Server-fed `sdkConfig.appName` wins; the
   * host page's `document.title` (the winner share line's same source) is
   * the fallback; null when neither exists (callers render generic copy).
   */
  public get publisherName(): string | null {
    const fed = this.sdkConfig?.appName?.trim();
    if (fed) return fed;
    if (typeof document !== 'undefined') {
      const title = document.title.trim();
      if (title) return title;
    }
    return null;
  }

  /**
   * Label for the capture screen's marketing-consent checkbox. Prefers the
   * nested per-screen override, then the flat legacy field, then the SDK
   * default. The config KEY stays `emailConsentText` for wire compatibility.
   */
  /**
   * Partner-authenticated email for the capture screen's read-only pre-fill.
   * Shape-checked here so a partner bug degrades to the editable field rather
   * than locking a garbage value; the server revalidates regardless.
   */
  public get prefilledEmail(): string | null {
    const raw = this.deps.userPrefill?.email?.trim().toLowerCase() ?? '';
    return raw.includes('@') && raw.includes('.') && raw.length >= 6 && raw.length <= 254
      ? raw
      : null;
  }

  public get marketingConsentText(): string {
    const copy = this.sdkConfig?.copy;
    return (
      copy?.emailCapture?.emailConsentText ||
      copy?.emailConsentText ||
      DEFAULT_MARKETING_CONSENT_TEXT
    );
  }

  /**
   * Label for the capture screen's AGE-GATE checkbox. A compliance string, so
   * it must never contradict the publisher's configured minimum age: prefer
   * the server-provided `ageGateText` verbatim (nested per-screen, then flat
   * legacy), and only when absent BUILD the sentence from `ageGateMinAge`
   * (default 18) — never a hardcoded "18".
   */
  public get ageGateText(): string {
    const copy = this.sdkConfig?.copy;
    const serverText = copy?.emailCapture?.ageGateText || copy?.ageGateText;
    if (serverText) return serverText;
    const minAge = this.sdkConfig?.ageGateMinAge ?? 18;
    return `I confirm I am ${minAge} years of age or older`;
  }

  // ─── Email consent gate ───

  private get emailSubmittedKey(): string {
    return emailSubmittedStorageKey(this.deps.bundleId);
  }

  private get giveawayCacheKey(): string {
    return AVAFLI_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY;
  }

  /**
   * Whether the user has completed email capture (required before claiming).
   * Gated on the non-PII "email submitted" flag — raw email is never stored —
   * plus the presence of the handshake user_uid.
   */
  public get hasEmailConsent(): boolean {
    const submitted = this.deps.storage.getItem(this.emailSubmittedKey) === 'true';
    return submitted && this.deps.hasRegisteredUuid();
  }

  // ─── Cache-first render ───

  /**
   * True once the dashboard has been painted from CACHED values, before any
   * network response landed. Read by the dashboard render (a cache frame has
   * no staged grant, so it must not pin the stats to N-1 or fire a tile
   * celebration) and used as a guard so a non-authoritative failure doesn't
   * replace a live dashboard with a loading/empty screen. Cleared the moment
   * fresh truth arrives.
   */
  public hydratedFromCache = false;

  private get streakStateKey(): string {
    return AVAFLI_CONSTANTS.STORAGE_KEYS.STREAK_STATE;
  }

  /**
   * Paints the dashboard IMMEDIATELY from cached state (giveaway config +
   * persisted streak), skipping the loading phase entirely.
   *
   * The drawer used to sit on a skeleton for as long as the sequential
   * registerDevice → getActiveGiveaway → claim round-trips took, even when
   * every value it needed was already on the device. Everything here is a
   * SYNCHRONOUS local read, so the caller can paint the result as the
   * experience's very first frame; {@link load} then reconciles in place with
   * the same no-replay guards the celebration staging already uses (the
   * reveal flags are untouched, so a staged celebration still fires exactly
   * once).
   *
   * Deliberately does NOT `transition()` — the caller (the experience root)
   * paints the returned state as its first render, so there is no
   * loading-then-dashboard double paint.
   *
   * Returns false (leaving the skeleton up) when anything is missing or when
   * a fresh response has already resolved the phase — a first-ever open, an
   * unconsented user who must see email capture first, or a cold cache all
   * take the genuine loading path.
   */
  public hydrateFromCache(): boolean {
    if (this.state.kind !== 'loading') return false; // never stomp fresher truth

    const giveaway = this.deps.cachedGiveaway ?? this.readCachedGiveaway();
    if (!giveaway) return false;

    // Day 1 / unconsented users must land on email capture, NEVER a cached
    // dashboard. This gate is the whole reason the cache path is safe.
    if (!this.hasEmailConsent) return false;

    const streak = this.readCachedStreakState();
    if (!streak || typeof streak.currentDay !== 'number') return false;

    this.giveaway = giveaway;
    this.streakDay = streak.currentDay;
    if (typeof streak.totalEntriesEarned === 'number') {
      this.totalEntries = streak.totalEntriesEarned;
    }
    this.claimedToday = this.deps.cachedClaimedToday ?? isToday(streak.lastClaimedDate);
    this.hydratedFromCache = true;
    this.state = { kind: 'dashboard' };
    return true;
  }

  private readCachedGiveaway(): Giveaway | null {
    const cached = this.deps.storage.getItem(this.giveawayCacheKey);
    if (!cached) return null;
    try {
      return JSON.parse(cached) as Giveaway;
    } catch {
      this.deps.storage.removeItem(this.giveawayCacheKey);
      return null;
    }
  }

  private readCachedStreakState(): Partial<StreakState> | null {
    const cached = this.deps.storage.getItem(this.streakStateKey);
    if (!cached) return null;
    try {
      return JSON.parse(cached) as Partial<StreakState>;
    } catch {
      return null;
    }
  }

  /**
   * Persists the claim response into the cached streak state, so the NEXT
   * open's cache-first frame paints today's post-claim numbers instead of
   * whatever the last getActiveGiveaway happened to report (which never
   * includes the claim that followed it). Mirrors what iOS/Android/Flutter
   * already do on claim success. Best-effort — a storage failure only costs
   * the cache frame, never the claim.
   */
  private persistClaimedStreakState(response: ClaimDailyEntriesResponse): void {
    try {
      const existing = this.readCachedStreakState();
      this.deps.storage.setItem(
        this.streakStateKey,
        JSON.stringify({
          ...existing,
          currentDay: response.streakDay,
          lastClaimedDate: new Date(),
          totalEntriesEarned: response.totalEntries,
          ...(response.weeklyCurrent !== undefined && { weeklyCurrent: response.weeklyCurrent }),
          ...(response.monthlyCurrent !== undefined && { monthlyCurrent: response.monthlyCurrent }),
        })
      );
    } catch (error) {
      logger.debug('Persisting post-claim streak state failed (cache frame only):', error);
    }
  }

  /** Warms the publisher's remote art (prize hero + logo) — see prewarmImage. */
  public prewarmPublisherArt(): void {
    prewarmImage(this.giveaway?.prizeImageUrl);
    prewarmImage(this.sdkConfig?.branding?.logoUrl);
  }

  // ─── State machine ───

  private transition(state: V2State): void {
    this.state = state;
    this.onChange?.(state);
  }

  public async load(): Promise<void> {
    let pendingPrizeClaim: PrizeClaimBlock | null = null;
    try {
      const response = await this.deps.api.getActiveGiveaway();
      // Fresh truth has landed — everything below overwrites the cache-first
      // frame, so the dashboard renders normally again from here on.
      this.hydratedFromCache = false;
      this.deps.onGiveawayRefreshed?.(response);

      // RTD: an opted-out person never sees the experience content.
      if (response.optedOut === true) {
        this.transition({ kind: 'empty' });
        return;
      }

      // Winner prize claim: a PENDING block takes precedence over the
      // dashboard on open (routed below, once the caches are synced).
      // A "submitted" block is ignored — the normal dashboard shows.
      if (response.prizeClaim?.status === 'pending' && !this.suppressWinnerClaim) {
        pendingPrizeClaim = response.prizeClaim;
      }

      // A pending prize claim can outlive its giveaway — the winner flow
      // still shows even when the backend has no active giveaway.
      if (!response.giveaway && !pendingPrizeClaim) {
        this.giveaway = null;
        this.deps.storage.removeItem(this.giveawayCacheKey);
        this.transition({ kind: 'empty' });
        return;
      }

      this.giveaway = response.giveaway;
      this.claimedToday = response.claimedToday === true;
      // Soft verification: ONLY an explicit false means "unverified". Absent
      // leaves whatever we already knew untouched (verified/partner/no-email).
      if (response.emailVerified === false) {
        this.unverified = true;
      } else if (response.emailVerified === true) {
        this.unverified = false;
      }
      if (typeof response.streakDay === 'number') this.streakDay = response.streakDay;
      if (typeof response.totalEntries === 'number') this.totalEntries = response.totalEntries;
      if (this.deps.resolveSdkConfig) {
        this.sdkConfig = this.deps.resolveSdkConfig();
      } else if (response.sdkConfig) {
        this.sdkConfig = response.sdkConfig;
      }

      // Backend is the source of truth for email consent. If it confirms an
      // email on file, seed the local "submitted" flag so a user whose local
      // flag was lost isn't re-prompted for email.
      if (response.emailConsentStatus === true) {
        this.deps.storage.setItem(this.emailSubmittedKey, 'true');
      }

      if (response.giveaway) {
        this.deps.storage.setItem(this.giveawayCacheKey, JSON.stringify(response.giveaway));
      }

      // Keep the prize art (and logo) warm across a prize change mid-session —
      // the giveaway refresh is the moment we learn the new URLs.
      this.prewarmPublisherArt();
    } catch (error) {
      // Session expired: the 401 → token-refresh path failed. This is an
      // authoritative auth failure, not a transient blip — collapsing it into
      // the generic empty state ("Nothing to see here yet") hid the real
      // problem. Render the dedicated retryable state instead.
      if (error instanceof AvafliError && error.code === AvafliErrorCode.AuthenticationRequired) {
        logger.warn('Session expired (token refresh failed) — showing retry state');
        this.hydratedFromCache = false;
        this.transition({ kind: 'sessionExpired' });
        return;
      }

      // Offline fallback: use cached giveaway.
      if (!this.giveaway) {
        const cached = this.deps.storage.getItem(this.giveawayCacheKey);
        if (cached) {
          try {
            this.giveaway = JSON.parse(cached) as Giveaway;
          } catch {
            this.deps.storage.removeItem(this.giveawayCacheKey);
          }
        }
      }
      logger.debug('Using cached giveaway (offline):', error);
      if (!this.giveaway) {
        this.transition({ kind: 'empty' });
        return;
      }
      // NOTE: a cache-first render always leaves `this.giveaway` set, so a
      // network hiccup after the dashboard is already painted can never
      // replace it with the empty state — it just keeps showing cached truth.
    }

    // Winner prize claim takes precedence over the email gate and the
    // auto-claim/dashboard on open — the claim is keyed to the account
    // server-side, so it works even before the email-capture flow (and when
    // the giveaway is null). The daily auto-claim still fires silently in the
    // background so the winner's entries keep accruing.
    if (pendingPrizeClaim) {
      this.winnerClaimStep = { kind: 'splash' };
      this.transition({ kind: 'winnerClaim', claim: pendingPrizeClaim });
      analyticsAdapter.track('avafli_winner_claim_shown', {
        giveaway_id: pendingPrizeClaim.giveawayId,
      });
      if (!this.claimedToday && this.hasEmailConsent) {
        void this.silentDailyClaim();
      }
      return;
    }

    // Adoption RE-ENTRY (2.9): a previous session typed an email that matched
    // an existing account but never finished the 6-digit code. Backend truth
    // (`adoptionPending` on the register response) routes this open straight
    // to the code screen — restageAdoption mails a fresh code first. One-shot
    // per controller; a restage failure still shows the code screen (the
    // "Send a new code" affordance re-attempts the send).
    if (this.deps.adoptionPending && !this.adoptionReentryStaged) {
      this.adoptionReentryStaged = true;
      try {
        await this.deps.restageAdoption?.();
      } catch (error) {
        logger.warn('restageAdoption failed — code screen still shown (resend available):', error);
      }
      this.codeError = null;
      this.transition({ kind: 'codeEntry', reentry: true });
      return;
    }

    // Email-capture gate: shown until the user completes the consent flow.
    if (!this.hasEmailConsent) {
      this.transition({ kind: 'emailCapture' });
      return;
    }

    // Day 2+ (today's claim is day 2 or later per the server, unclaimed):
    // the celebration is the dashboard's FIRST VISIBLE FRAME. Stage a
    // PREDICTED grant from the pre-claim response (no waiting on the claim
    // round-trip), enter the dashboard, arm the first-mount reveal, and
    // reconcile with the real claim in the background. `streakDay` here is
    // the server's "day today's claim will be" (getActiveGiveaway already
    // advanced it past the last-claimed day), so the gate reads directly:
    // >= 2 means an alive streak. Day 1 (brand-new or broken streak —
    // server streakDay 0/1) must NEVER stage the predicted celebration; its
    // reveal is staged from the awaited claim response below instead.
    if (!this.claimedToday && this.streakDay >= 2) {
      this.stagePredictedReveal();
      this.transition({ kind: 'dashboard' });
      this.scheduleAutoReveal();
      void this.reconcileClaimInBackground();
      return;
    }

    // Day 1 (brand-new or restarted streak, typically right after email
    // capture): entries are granted automatically — no tap required. The
    // CURRENT screen holds while the claim is awaited (the capture form's
    // CTA spinner, or the loading state — never a bare pre-claim dashboard),
    // and autoClaim() lands on the dashboard mounting as its first-frame
    // celebration, staged straight from the claim response.
    if (!this.claimedToday) {
      await this.autoClaim();
      return;
    }

    this.transition({ kind: 'dashboard' });
  }

  /**
   * Stages the Day 2+ celebration from the PRE-claim status response alone.
   *
   * SERVER CONTRACT (getActiveGiveaway, the source of truth): when today is
   * still unclaimed, `streakDay` is ALREADY the day today's claim will be —
   * the backend advances it past the last-claimed day ("next day to claim"),
   * and claimDailyEntries later returns that SAME number. So the predicted
   * grant is simply `ladderValue(streakDay)` — never `streakDay + 1`. A +1
   * here double-advances the day (the off-by-one that shipped as "6 DAY
   * STREAK under a checked DAY-7 tile" on the live demo): the tiles and
   * come-back bar render one day ahead, and the header then reconciles back
   * to server truth while they don't.
   */
  private stagePredictedReveal(): void {
    const claimDay = this.streakDay; // today's claim day, per the server
    const preTotal = this.totalEntries;
    this.preRevealSnapshot = { streakDay: claimDay, totalEntries: preTotal };

    const predicted = this.ladderValue(claimDay);
    this.pendingRevealGrant = { baseEntries: predicted, bonusEntries: 0 };
    this.claimRevealed = false;
    this.preClaimTotalEntries = preTotal;
    this.totalEntries = preTotal + predicted;
  }

  /**
   * The real claim, fired in the background behind the predicted celebration.
   * Success reconciles the grant/streak/totals silently (onRevealReconcile —
   * never a second celebration). "Already claimed" (another device beat us)
   * re-syncs authoritative state once; other failures settle back to the
   * pre-claim server truth quietly.
   */
  private async reconcileClaimInBackground(): Promise<void> {
    if (this.isClaiming) return;
    this.isClaiming = true;
    try {
      const stagedDay = this.streakDay; // the day the celebration was staged for
      const response = await this.deps.api.claimDailyEntries();

      let bonus = 0;
      if (response.weeklyBonusEntries) bonus += response.weeklyBonusEntries;
      if (response.monthlyBonusEntries) bonus += response.monthlyBonusEntries;
      if (response.milestone) bonus += response.milestone.bonusEntries;
      if (response.monthlyMilestone) bonus += response.monthlyMilestone.bonusEntries;

      this.claimedToday = true;
      this.claimFailedNotice = false;
      this.streakDay = response.streakDay;
      // Server truth, verbatim: totalEntries is the backend's PER-GIVEAWAY
      // balance, which can legitimately differ from a local
      // ladder-sum-through-day-N: earlier streak RUNS in the same giveaway
      // (totals survive a streak reset — e.g. days 1-5 then a break then
      // days 1-9 shows 600, not 450), legacy lifetime seeding at the
      // giveaway_totals migration, cross-device adoption merges, and admin
      // adjustments. Never recompute or "correct" it client-side.
      this.totalEntries = response.totalEntries;
      this.pendingRevealGrant = { baseEntries: response.entries, bonusEntries: bonus };
      this.preClaimTotalEntries = response.totalEntries - (response.entries + bonus);
      this.preRevealSnapshot = null;
      this.persistClaimedStreakState(response);

      analyticsAdapter.track('avafli_daily_entry_claimed', {
        day: response.streakDay,
        entries: response.entries,
        ...(response.weeklyBonusEntries ? { weekly_bonus: response.weeklyBonusEntries } : {}),
        ...(response.monthlyBonusEntries ? { monthly_bonus: response.monthlyBonusEntries } : {}),
        ...(response.milestone
          ? {
              milestone_day: response.milestone.day,
              milestone_bonus: response.milestone.bonusEntries,
            }
          : {}),
      });
      this.onComplete?.({
        entries: response.entries,
        streakDay: response.streakDay,
        totalEntries: response.totalEntries,
        ...(response.weeklyBonusEntries !== undefined
          ? { weeklyBonusEntries: response.weeklyBonusEntries }
          : {}),
        ...(response.monthlyBonusEntries !== undefined
          ? { monthlyBonusEntries: response.monthlyBonusEntries }
          : {}),
        ...(response.milestone ? { milestone: response.milestone } : {}),
      });

      if (response.streakDay !== stagedDay && this.state.kind === 'dashboard') {
        // The server disagrees with the staged day (midnight rollover, a
        // cross-device claim, a reset race). The quiet in-place reconcile
        // only rewrites the header label and total — the TILES and come-back
        // bar were rendered at the staged day and would stay one day off
        // (the exact class of bug the header/tile disagreement was). A full
        // repaint from server truth keeps every surface in agreement.
        this.transition({ kind: 'dashboard' });
      } else {
        this.onRevealReconcile?.();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Geo-fence rejection: dedicated screen, never a silent settle. Roll
      // back the predicted celebration first — nothing was granted.
      if (isGeoBlockedError(message)) {
        logger.info('Claim geo-blocked — showing location state');
        this.claimedToday = false;
        this.cancelAutoReveal();
        this.pendingRevealGrant = null;
        this.preClaimTotalEntries = null;
        if (this.preRevealSnapshot) {
          this.streakDay = this.preRevealSnapshot.streakDay;
          this.totalEntries = this.preRevealSnapshot.totalEntries;
          this.preRevealSnapshot = null;
        }
        this.transition({ kind: 'geoBlocked' });
        return;
      }

      if (/email confirmation is required/i.test(message)) {
        // The server has no email for this user but our cached "email
        // submitted" flag said otherwise — the local cache is stale (e.g. the
        // account was deleted/reset server-side and this device re-registered
        // fresh). Self-heal: drop the stale flag and route to email capture
        // instead of surfacing a bogus connection error.
        logger.info('Server requires email but local cache said captured — resetting to capture');
        this.deps.storage.removeItem(this.emailSubmittedKey);
        this.cancelAutoReveal();
        this.pendingRevealGrant = null;
        this.preClaimTotalEntries = null;
        this.preRevealSnapshot = null;
        this.isClaiming = false;
        this.transition({ kind: 'emailCapture' });
        return;
      }

      if (/already claimed|already entered/i.test(message)) {
        // Another device claimed between the status fetch and our claim. Not
        // news worth celebrating twice: drop the predicted grant (cancelling
        // the reveal if it hasn't fired) and pull authoritative state ONCE.
        // Local state thought today was UNCLAIMED (that's why a claim ran) —
        // tell the user what happened instead of silently flipping state.
        logger.info('Already claimed today — updating local state');
        this.claimedToday = true;
        this.dashboardNotice = AvafliV2Strings.alreadyEnteredToday;
        this.cancelAutoReveal();
        this.pendingRevealGrant = null;
        this.preClaimTotalEntries = null;
        if (this.preRevealSnapshot) {
          // The predicted bump sat on top of numbers that (per the server)
          // already include today's cross-device claim — roll it back.
          this.streakDay = this.preRevealSnapshot.streakDay;
          this.totalEntries = this.preRevealSnapshot.totalEntries;
          this.preRevealSnapshot = null;
        }
        if (!this.didResyncAfterAlreadyClaimed) {
          this.didResyncAfterAlreadyClaimed = true;
          this.isClaiming = false;
          await this.load();
        } else {
          this.transition({ kind: 'dashboard' });
        }
        return;
      }

      // Other failures settle back to the pre-claim server truth. Never fake
      // a local success — and never fail silently either: the dashboard gets
      // a retryable "couldn't record today's entry" notice.
      logger.info('Auto-claim declined:', error);
      this.claimedToday = false;
      this.claimFailedNotice = true;
      this.cancelAutoReveal();
      this.pendingRevealGrant = null;
      this.preClaimTotalEntries = null;
      if (this.preRevealSnapshot) {
        this.streakDay = this.preRevealSnapshot.streakDay;
        this.totalEntries = this.preRevealSnapshot.totalEntries;
        this.preRevealSnapshot = null;
      }
      if (this.claimRevealed) {
        // The celebration already played on predicted numbers — the quietest
        // settle is an in-place totals update, not a jarring re-render.
        this.onRevealReconcile?.();
      } else if (this.state.kind === 'dashboard') {
        this.transition({ kind: 'dashboard' });
      }
    } finally {
      this.isClaiming = false;
    }
  }

  private async autoClaim(): Promise<void> {
    if (this.isClaiming) return;
    this.isClaiming = true;
    try {
      const response = await this.deps.api.claimDailyEntries();

      // Streak bonuses (weekly/monthly/milestone) roll into bonusEntries so the
      // celebration shows the full amount earned today.
      let bonus = 0;
      if (response.weeklyBonusEntries) bonus += response.weeklyBonusEntries;
      if (response.monthlyBonusEntries) bonus += response.monthlyBonusEntries;
      if (response.milestone) bonus += response.milestone.bonusEntries;
      if (response.monthlyMilestone) bonus += response.monthlyMilestone.bonusEntries;

      this.claimedToday = true;
      this.claimFailedNotice = false;
      this.streakDay = response.streakDay;
      this.totalEntries = response.totalEntries;
      this.persistClaimedStreakState(response);

      analyticsAdapter.track('avafli_daily_entry_claimed', {
        day: response.streakDay,
        entries: response.entries,
        ...(response.weeklyBonusEntries ? { weekly_bonus: response.weeklyBonusEntries } : {}),
        ...(response.monthlyBonusEntries ? { monthly_bonus: response.monthlyBonusEntries } : {}),
        ...(response.milestone
          ? {
              milestone_day: response.milestone.day,
              milestone_bonus: response.milestone.bonusEntries,
            }
          : {}),
      });

      this.onComplete?.({
        entries: response.entries,
        streakDay: response.streakDay,
        totalEntries: response.totalEntries,
        ...(response.weeklyBonusEntries !== undefined
          ? { weeklyBonusEntries: response.weeklyBonusEntries }
          : {}),
        ...(response.monthlyBonusEntries !== undefined
          ? { monthlyBonusEntries: response.monthlyBonusEntries }
          : {}),
        ...(response.milestone ? { milestone: response.milestone } : {}),
      });

      // V2 auto-claim routing: Day 1 is UNIFIED with Day 2+ — no modal, no
      // claim click. The reveal is staged straight from the claim response
      // and the dashboard mounts as its first-frame celebration ("YOU'RE
      // IN!" toast + 0→N count-up on Day 1, the streak toast on Day 2+).
      this.pendingRevealGrant = { baseEntries: response.entries, bonusEntries: bonus };
      this.claimRevealed = false;
      this.preClaimTotalEntries = response.totalEntries - (response.entries + bonus);
      this.transition({ kind: 'dashboard' });
      // Armed HERE (not in the render): the claim response is what stages
      // the grant, and the dashboard may already have been on screen.
      this.scheduleAutoReveal();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Geo-fence rejection: dedicated screen, never the generic dashboard.
      if (isGeoBlockedError(message)) {
        logger.info('Claim geo-blocked — showing location state');
        this.claimedToday = false;
        this.transition({ kind: 'geoBlocked' });
        return;
      }

      // "Already claimed" means the user already got their entries today
      // (another device beat us between the status fetch and the claim). This
      // isn't news worth celebrating — show the dashboard in its claimed state,
      // then re-load ONCE to pull the authoritative streak/total. Local state
      // did NOT know (a claim only runs when claimedToday was false), so tell
      // the user what happened via a transient dashboard notice — a normal
      // open with claimedToday already known never takes this path.
      if (/email confirmation is required/i.test(message)) {
        // The server has no email for this user but our cached "email
        // submitted" flag said otherwise — the local cache is stale (e.g. the
        // account was deleted/reset server-side and this device re-registered
        // fresh). Self-heal: drop the stale flag and route to email capture
        // instead of surfacing a bogus connection error.
        logger.info('Server requires email but local cache said captured — resetting to capture');
        this.deps.storage.removeItem(this.emailSubmittedKey);
        this.cancelAutoReveal();
        this.pendingRevealGrant = null;
        this.preClaimTotalEntries = null;
        this.preRevealSnapshot = null;
        this.isClaiming = false;
        this.transition({ kind: 'emailCapture' });
        return;
      }

      if (/already claimed|already entered/i.test(message)) {
        logger.info('Already claimed today — updating local state');
        this.claimedToday = true;
        this.dashboardNotice = AvafliV2Strings.alreadyEnteredToday;
        this.transition({ kind: 'dashboard' });
        if (!this.didResyncAfterAlreadyClaimed) {
          this.didResyncAfterAlreadyClaimed = true;
          this.isClaiming = false;
          await this.load();
        }
        return;
      }

      // Transport/other failure: the dashboard shows the honest UNCLAIMED
      // state plus a retryable notice. Never fake a local success for an
      // auto-claim — and never swallow the failure silently.
      logger.info('Auto-claim declined:', error);
      this.claimedToday = false;
      this.claimFailedNotice = true;
      this.transition({ kind: 'dashboard' });
    } finally {
      this.isClaiming = false;
    }
  }

  /**
   * Retry affordance for the claim-failure notice: re-attempts the claim.
   * Success re-enters the dashboard with the reveal staged from the claim
   * response (the celebration the failed attempt owed the user); another
   * failure re-arms the notice.
   */
  public async retryClaim(): Promise<void> {
    if (this.isClaiming || this.claimedToday) return;
    this.claimFailedNotice = false;
    await this.autoClaim();
  }

  // ─── Email capture ───

  /**
   * Capture-screen submit. `consent` carries BOTH checkboxes exactly as the
   * user left them — the age gate (which the CTA already required) and the
   * pre-checked MARKETING consent (which the user may have turned off without
   * losing their entry, or their winner contact).
   */
  public async submitEmail(email: string, consent: EmailCaptureConsent): Promise<void> {
    if (!email || this.isSubmittingEmail) return;
    this.isSubmittingEmail = true;
    this.emailSubmitError = null;
    this.onChange?.(this.state); // re-render the CTA into its loading state

    try {
      // Cross-device streak unification: if this email already belonged to an
      // existing user under this publisher, submitEmailAndAdopt switches the
      // session to that canonical user's credentials.
      // `ageConfirmed` is ALWAYS sent — the backend keys off it to detect a
      // 2.4.0+ client.
      const submitRes = (await this.deps.submitEmailAndAdopt({
        email,
        ageConfirmed: consent.ageConfirmed,
        marketingConsent: consent.marketingConsent,
      })) as { verificationRequired?: boolean; emailVerified?: boolean } | undefined;
      analyticsAdapter.track('avafli_email_captured');
      logger.info('Email submitted to backend');

      // A brand-new, unconfirmed email comes back with emailVerified === false —
      // surface the persistent verify chip on the dashboard the user lands on.
      // Only an explicit false flips it on (absent = verified/adopted/partner).
      if (submitRes?.emailVerified === false) {
        this.unverified = true;
      } else if (submitRes?.emailVerified === true) {
        this.unverified = false;
      }

      // NOTE: We deliberately do NOT persist the raw email locally (PII-High).
      // The backend stores it encrypted; registration state is derived from
      // the non-PII "submitted" flag + the handshake user_uid. Set only on a
      // CONFIRMED submit — a failed one must leave the email gate closed so
      // the user can retry, not be marched forward as if it succeeded.
      this.deps.storage.setItem(this.emailSubmittedKey, 'true');

      // The typed address matches an EXISTING account: the merge is parked
      // until the person proves the inbox is theirs. Kept in memory only —
      // the raw address is PII and is never persisted locally.
      if (submitRes?.verificationRequired) {
        this.isSubmittingEmail = false;
        this.transition({ kind: 'codeEntry', email, consent });
        return;
      }
    } catch (error) {
      logger.error('Email submit to backend failed:', error);
      this.isSubmittingEmail = false;
      const message = error instanceof Error ? error.message : String(error);
      if (isGeoBlockedError(message)) {
        // submitEmail is geo-fenced backend-side — show the dedicated state.
        this.transition({ kind: 'geoBlocked' });
        return;
      }
      // Stay on the capture screen with an inline error so the user can
      // retry; the old behavior swallowed this and proceeded as success.
      this.emailSubmitError = AvafliV2Strings.emailSubmitFailed;
      this.onChange?.(this.state);
      return;
    }

    // Re-load so the (possibly switched) canonical user's authoritative
    // streak + claim status drive the UI (and the auto-claim fires). The
    // CAPTURE SCREEN HOLDS — its CTA spinner keeps spinning — through the
    // reload AND the awaited Day-1 claim, so the next frame the user sees is
    // the dashboard mounting as its first-frame celebration (never a bare
    // pre-claim dashboard, never an interstitial loading screen).
    try {
      await this.load();
    } finally {
      this.isSubmittingEmail = false;
      // If we settled back on the capture (e.g. consent didn't stick), the
      // CTA must come out of its spinner state.
      if (this.state.kind === 'emailCapture') this.onChange?.(this.state);
    }
  }

  /** True while a 6-digit code is being checked. */
  public isVerifyingCode = false;
  /** Last code-check failure, shown inline on the code screen. */
  public codeError: string | null = null;

  /** Submit the 6-digit adoption code; on approval the merge completes and the
   *  normal reload takes the (now canonical) user to the dashboard. */
  public async submitVerificationCode(code: string): Promise<void> {
    if (this.state.kind !== 'codeEntry' || this.isVerifyingCode) return;
    this.isVerifyingCode = true;
    this.codeError = null;
    this.onChange?.(this.state);
    try {
      await this.deps.verifyAdoptionCode?.({ code });
      analyticsAdapter.track('avafli_adoption_verified');
      // The adoption is complete — clear the SDK's cached adoptionPending
      // flag so later drawer-opens don't re-stage a finished adoption.
      this.deps.onAdoptionResolved?.();
      await this.load();
    } catch (error) {
      // NEVER render raw backend text — map the failure to fixed copy
      // (Master Field List; see AvafliV2Strings).
      const message = error instanceof Error ? error.message : String(error);
      if (/expired/i.test(message)) {
        this.codeError = AvafliV2Strings.codeExpired;
      } else if (/attempts/i.test(message)) {
        this.codeError = AvafliV2Strings.codeTooManyAttempts;
      } else {
        this.codeError = AvafliV2Strings.codeIncorrect;
      }
      logger.warn('Adoption code check failed:', error);
      this.onChange?.(this.state);
    } finally {
      this.isVerifyingCode = false;
      if (this.state.kind === 'codeEntry') this.onChange?.(this.state);
    }
  }

  /**
   * Request a fresh code by re-submitting the same email. The code screen
   * STAYS UP throughout — a failed resend surfaces in the code-error slot
   * instead of dumping the user back on email capture with no explanation.
   */
  public async resendVerificationCode(): Promise<void> {
    if (this.state.kind !== 'codeEntry' || this.isVerifyingCode) return;
    const { email, consent } = this.state;
    this.codeError = null;
    this.onChange?.(this.state);

    // RE-ENTRY mode has no email in memory (PII is never persisted) — a
    // fresh code comes from restageAdoption instead of a re-submit.
    if (!email || !consent) {
      try {
        await this.deps.restageAdoption?.();
        this.onChange?.(this.state);
      } catch (error) {
        logger.warn('Re-entry code resend (restageAdoption) failed:', error);
        this.codeError = AvafliV2Strings.codeResendFailed;
        this.onChange?.(this.state);
      }
      return;
    }

    try {
      // Re-submitting the ORIGINAL consent values is idempotent (same person,
      // same choices) and re-triggers the OTP send. Fabricating values here
      // would overwrite the marketing choice the person actually made.
      const submitRes = (await this.deps.submitEmailAndAdopt({
        email,
        ageConfirmed: consent.ageConfirmed,
        marketingConsent: consent.marketingConsent,
      })) as { verificationRequired?: boolean } | undefined;
      if (submitRes?.verificationRequired) {
        // Fresh code sent — stay on the code screen, ready for input.
        this.onChange?.(this.state);
        return;
      }
      // Verification is no longer required (e.g. the merge already
      // completed) — proceed exactly like a plain successful submit.
      this.deps.storage.setItem(this.emailSubmittedKey, 'true');
      await this.load();
    } catch (error) {
      logger.warn('Resend verification code failed:', error);
      this.codeError = AvafliV2Strings.codeResendFailed;
      this.onChange?.(this.state);
    }
  }

  // ─── Soft email verification (dashboard chip → reused code screen) ───
  //
  // Fully dismissible: this flow gates NOTHING. It reuses the exact 6-digit
  // code component (and the same isVerifyingCode / codeError surfaces + fixed
  // error copy) as the adoption OTP — the only differences are the callables
  // it invokes, the header/subtitle copy, and a back/cancel to the dashboard.

  /** Tap the "Verify your email" chip → open the reused code screen. */
  public showEmailVerify(): void {
    if (this.state.kind !== 'dashboard') return;
    this.codeError = null;
    this.transition({ kind: 'emailVerify' });
  }

  /** Back/cancel on the verify screen → return to the dashboard (no-op else). */
  public cancelEmailVerify(): void {
    if (this.state.kind !== 'emailVerify') return;
    this.codeError = null;
    this.transition({ kind: 'dashboard' });
  }

  /**
   * Submit the 6-digit soft-verification code. On success the chip is cleared
   * and a brief "Email verified ✓" confirmation shows on the dashboard;
   * failures map to the SAME fixed copy as the adoption flow.
   */
  public async confirmEmailVerificationCode(code: string): Promise<void> {
    if (this.state.kind !== 'emailVerify' || this.isVerifyingCode) return;
    this.isVerifyingCode = true;
    this.codeError = null;
    this.onChange?.(this.state);
    try {
      await this.deps.confirmEmailVerification?.({ code });
      analyticsAdapter.track('avafli_email_verified');
      this.unverified = false;
      this.isVerifyingCode = false;
      // Reuse the dashboard's transient-notice surface for the confirmation.
      this.dashboardNotice = AvafliV2Strings.emailVerified;
      this.transition({ kind: 'dashboard' });
    } catch (error) {
      // NEVER render raw backend text — map to the fixed adoption copy.
      const message = error instanceof Error ? error.message : String(error);
      if (/expired/i.test(message)) {
        this.codeError = AvafliV2Strings.codeExpired;
      } else if (/attempts/i.test(message)) {
        this.codeError = AvafliV2Strings.codeTooManyAttempts;
      } else {
        this.codeError = AvafliV2Strings.codeIncorrect;
      }
      logger.warn('Email verification code check failed:', error);
      this.isVerifyingCode = false;
      if (this.state.kind === 'emailVerify') this.onChange?.(this.state);
    }
  }

  /**
   * Re-send the soft-verification code. The verify screen STAYS UP throughout;
   * a failed resend surfaces in the code-error slot (consistent with the
   * adoption resend fix).
   */
  public async resendEmailVerificationCode(): Promise<void> {
    if (this.state.kind !== 'emailVerify' || this.isVerifyingCode) return;
    this.codeError = null;
    this.onChange?.(this.state);
    try {
      await this.deps.resendEmailVerification?.();
    } catch (error) {
      logger.warn('Resend email verification code failed:', error);
      this.codeError = AvafliV2Strings.codeResendFailed;
      if (this.state.kind === 'emailVerify') this.onChange?.(this.state);
    }
  }

  // ─── Winner prize claim ───

  /**
   * Fire-and-forget daily claim while the winner flow is on screen — the
   * winner still accrues their streak entries, but nothing is revealed.
   */
  private async silentDailyClaim(): Promise<void> {
    try {
      const response = await this.deps.api.claimDailyEntries();
      this.claimedToday = true;
      this.streakDay = response.streakDay;
      this.totalEntries = response.totalEntries;
      this.persistClaimedStreakState(response);
      logger.debug(`Silent daily claim during winner flow: +${response.entries}`);
    } catch (error) {
      logger.debug('Silent daily claim declined during winner flow:', error);
    }
  }

  /** Splash CONTINUE → the claim form. */
  public winnerClaimContinue(): void {
    if (this.state.kind !== 'winnerClaim') return;
    this.winnerClaimStep = { kind: 'form' };
    this.onChange?.(this.state);
  }

  /**
   * CONTINUE on the post-submit share step → the confirmation screen. The
   * claim was already recorded before the share step showed, so this (and
   * closing the drawer instead) never affects the claim.
   */
  public winnerShareContinue(): void {
    if (this.state.kind !== 'winnerClaim' || this.winnerClaimStep.kind !== 'share') return;
    // A typed story is attached best-effort before moving on (never blocks).
    this.flushClaimStory();
    this.winnerClaimStep = {
      kind: 'confirmation',
      claimNumber: this.winnerClaimStep.claimNumber,
      submittedAt: this.winnerClaimStep.submittedAt,
    };
    this.onChange?.(this.state);
  }

  /**
   * SUBMIT on the claim form. Success → confirmation screen. A backend
   * "Not the winner"/"Already submitted" rejection falls back to the normal
   * dashboard silently (logged); transport failures surface inline
   * (`claimSubmitError` — read by the form after this settles).
   */
  public async submitPrizeClaim(form: PrizeClaimForm): Promise<void> {
    if (this.state.kind !== 'winnerClaim' || this.isSubmittingClaim) return;
    if (!isClaimFormValid(form)) return;
    const claim = this.state.claim;
    this.claimSubmitError = null;
    this.isSubmittingClaim = true;

    try {
      const response = await this.deps.api.submitPrizeClaim({
        giveawayId: claim.giveawayId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        street: form.street.trim(),
        ...(form.apt.trim() ? { apt: form.apt.trim() } : {}),
        city: form.city.trim(),
        state: form.state.trim(),
        zip: form.zip.trim(),
        country: CLAIM_COUNTRY,
        ...(form.photoBase64 ? { photoBase64: form.photoBase64 } : {}),
        // NOTE (2.9): `story` no longer rides this payload — it is typed on
        // the POST-submit share step and attached via attachClaimStory.
        // 2.9: the review screen's ONE optional checkbox, exactly as the user
        // left it (backend stores it in parallel — see SubmitPrizeClaimRequest).
        promoConsentGranted: form.authorizesLikeness,
      });
      this.isSubmittingClaim = false;
      this.submittedClaimForm = form;
      // 2.9: the claim is recorded — the SHARE step comes next (never
      // blocking; closing it changes nothing about the claim), then the
      // confirmation screen. Fresh story slate for this share step.
      this.claimStoryDraft = '';
      this.claimStoryFlushed = false;
      this.winnerClaimStep = {
        kind: 'share',
        claimNumber: response.claimNumber,
        submittedAt: response.submittedAt,
      };
      analyticsAdapter.track('avafli_prize_claim_submitted', {
        giveaway_id: claim.giveawayId,
        claim_number: response.claimNumber,
      });
      this.onChange?.(this.state);
    } catch (error) {
      this.isSubmittingClaim = false;
      const message = error instanceof Error ? error.message : String(error);
      if (/not the winner|already submitted/i.test(message)) {
        // Stale/duplicate winner state — never trap the user in the claim
        // flow. Fall back to the normal dashboard silently.
        logger.info(`Prize claim rejected (${message}) — falling back to dashboard`);
        this.suppressWinnerClaim = true;
        this.transition({ kind: 'loading' });
        await this.load();
        return;
      }
      logger.error('Prize claim submit failed:', error);
      this.claimSubmitError = AvafliV2Strings.claimSubmitFailed;
    }
  }

  // ─── Navigation ───

  /** RETRY on the session-expired screen — re-runs the load (the network
   *  client re-attempts the token refresh on the next 401). */
  public retryLoad(): void {
    this.transition({ kind: 'loading' });
    void this.load();
  }

  public showHowItWorks(): void {
    this.previousState = this.state;
    this.transition({ kind: 'howItWorks' });
  }

  public hideHowItWorks(): void {
    if (this.previousState) {
      const previous = this.previousState;
      this.previousState = null;
      this.transition(previous);
    } else {
      this.transition({ kind: 'loading' });
      void this.load();
    }
  }

  /** Close the whole experience (X buttons / GOT IT on the dashboard). */
  public requestDismiss(): void {
    this.onDismissRequest?.();
  }

  // ─── In-experience legal overlay (Official Rules / Privacy Policy) ───
  //
  // 2.9.5: legal documents open INSIDE the experience — an iframe overlay
  // covering the drawer/lightbox — instead of a new tab. The privacy page
  // loads with `?app=1`, which makes winrmedia.com/sdk/privacy render its
  // "Delete my data" section; in the framed case that section posts
  // `{ type: "winr-delete" }` to the parent, and the bridge below routes it
  // into the EXISTING destructive opt-out confirmation + erasure flow.

  /** The only postMessage origin the delete bridge accepts. */
  public static readonly LEGAL_BRIDGE_ORIGIN = 'https://winrmedia.com';

  /**
   * The open legal overlay, or null. `url` is what the iframe loads;
   * `fallbackUrl` is the "Open in new tab" escape hatch shown when the frame
   * fails to load (some publisher CSPs block framing us) — for privacy that
   * is the PLAIN policy URL, because outside the experience there is no
   * parent for the delete section to bridge to.
   */
  public legalOverlay: {
    doc: LegalDoc;
    title: string;
    url: string;
    fallbackUrl: string;
  } | null = null;

  /** Open the legal overlay. Rules without a configured rulesUrl is a no-op. */
  public showLegalOverlay(doc: LegalDoc): void {
    if (doc === 'rules') {
      const url = this.rulesUrl;
      if (!url) return;
      this.legalOverlay = { doc, title: 'Official Rules', url, fallbackUrl: url };
    } else {
      this.legalOverlay = {
        doc,
        title: 'Privacy Policy',
        url: withAppParam(AVAFLI_CONSTANTS.PRIVACY_URL),
        fallbackUrl: AVAFLI_CONSTANTS.PRIVACY_URL,
      };
    }
    // The delete bridge listens only while the overlay is open. (Re-adding
    // the same handler while already open is a spec-level no-op.)
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.onLegalBridgeMessage);
    }
    this.onChange?.(this.state);
  }

  /** Close the overlay and detach the delete bridge. Safe to call when closed. */
  public closeLegalOverlay(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.onLegalBridgeMessage);
    }
    if (!this.legalOverlay) return;
    this.legalOverlay = null;
    this.onChange?.(this.state);
  }

  /**
   * Delete bridge — active only while the overlay is open. Accepts ONLY
   * events whose origin is exactly {@link LEGAL_BRIDGE_ORIGIN} AND whose
   * data is `{ type: "winr-delete" }` or `{ type: "avafli-delete" }` (3.0:
   * the legal pages still live on winrmedia.com and post the legacy type;
   * the rebranded type is accepted so the pages can migrate without a
   * lockstep SDK release); everything else is ignored. A valid message
   * closes the overlay and raises the existing destructive confirmation
   * (the authenticated erasure flow is unchanged).
   */
  private readonly onLegalBridgeMessage = (event: MessageEvent): void => {
    if (!this.legalOverlay) return;
    if (event.origin !== V2ExperienceController.LEGAL_BRIDGE_ORIGIN) return;
    const data = event.data as { type?: unknown } | null | undefined;
    if (typeof data !== 'object' || data === null) return;
    if (data.type !== 'winr-delete' && data.type !== 'avafli-delete') return;
    this.closeLegalOverlay();
    this.showOptOutConfirmation();
  };

  // ─── RTD opt-out (delete-my-data confirmation) ───
  //
  //     idle → confirming → inFlight → done → (dismiss experience)
  //                    ↘ failed (inline error, retryable) ↗
  //
  // 2.9.5: reached from the "Delete my data" section INSIDE the privacy page
  // (legal overlay → postMessage bridge above). The intermediate "Privacy
  // choices" card (2.9) is gone — its delete listing moved into the page.
  // Failure NEVER pretends success — the confirmation stays up with the
  // error and the destructive button remains available to retry.

  /** How long "Your data has been deleted." holds before the dismiss. */
  public static readonly OPT_OUT_SUCCESS_HOLD_MS = 1400;

  /** Where the delete-my-data flow currently is. */
  public optOutPhase: 'idle' | 'confirming' | 'inFlight' | 'failed' | 'done' = 'idle';
  /** Inline error on the confirmation (`optOutPhase === 'failed'`). */
  public optOutError: string | null = null;

  /**
   * Raise the destructive delete-my-data confirmation. 2.9.5: invoked by the
   * legal overlay's delete bridge (the privacy page's "Delete my data"
   * section posting `winr-delete`); also callable directly (headless
   * integrations and tests reach the confirmation without the overlay).
   */
  public showOptOutConfirmation(): void {
    if (this.optOutPhase !== 'idle') return;
    this.optOutPhase = 'confirming';
    this.onChange?.(this.state);
  }

  /** Cancel / tap-outside. A no-op while in flight or after the deletion. */
  public cancelOptOut(): void {
    if (this.optOutPhase !== 'confirming' && this.optOutPhase !== 'failed') {
      return;
    }
    this.optOutPhase = 'idle';
    this.optOutError = null;
    this.onChange?.(this.state);
  }

  /**
   * DELETE MY DATA tapped (initial attempt or retry after failure). Success
   * shows "Your data has been deleted." briefly, then dismisses the WHOLE
   * experience; failure keeps the confirmation up with the standard
   * connection error and changes nothing locally.
   */
  public async confirmOptOut(): Promise<void> {
    if (this.optOutPhase !== 'confirming' && this.optOutPhase !== 'failed') return;
    this.optOutPhase = 'inFlight';
    this.optOutError = null;
    this.onChange?.(this.state);
    try {
      if (!this.deps.optOut) throw new Error('optOut dependency not wired');
      await this.deps.optOut();
      this.optOutPhase = 'done';
      this.onChange?.(this.state);
      setTimeout(() => this.requestDismiss(), V2ExperienceController.OPT_OUT_SUCCESS_HOLD_MS);
    } catch (error) {
      logger.error('Opt-out failed:', error);
      this.optOutPhase = 'failed';
      this.optOutError = AvafliV2Strings.optOutFailed;
      this.onChange?.(this.state);
    }
  }
}

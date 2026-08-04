import {
  DailyEntryGrant,
  GetActiveGiveawayResponse,
  Giveaway,
  PrizeClaimBlock,
  SDKConfig,
  SubmitEmailRequest,
  SubmitEmailResponse,
  WINRError,
  WINR_CONSTANTS,
} from '../../types';
import { CLAIM_COUNTRY, PrizeClaimForm, emptyClaimForm, isClaimFormValid } from './claim';
import { WINRAPI } from '../../network/api';
import { LocalStorageProvider } from '../../storage/local-storage';
import { logger } from '../../services/logger';
import { analyticsAdapter } from '../../services/analytics';
import { ladderEntries } from './v2-theme';

/**
 * V2 experience state machine — ported from iOS WINRExperienceViewModel.
 *
 * Flow: loading → (emailCapture | dashboard) → auto-claim on open →
 * Day 1: celebration modal (its GOT IT closes the experience) /
 * Day 2+: the celebration is the dashboard's FIRST VISIBLE FRAME — a
 * PREDICTED grant (ladder math over the pre-claim status response) is staged
 * before entering the dashboard, the in-place celebration (tile check +
 * confetti + totals advance) fires on first mount, and the real claim runs
 * in the background, reconciling totals/streak silently when it returns (no
 * second celebration; failures settle back to server truth quietly) /
 * silent claimed-state on "Already claimed" (with a ONE-SHOT re-sync so
 * cached totals catch up when another device claimed between the status
 * fetch and our claim).
 */

export type V2State =
  | { kind: 'loading' }
  | { kind: 'empty' } // no active giveaway / opted out / fatal error
  | { kind: 'emailCapture' }
  | { kind: 'dashboard' }
  | {
      kind: 'celebration';
      baseEntries: number;
      bonusEntries: number;
      totalEntries: number;
    }
  | { kind: 'howItWorks' }
  /**
   * This person is the drawn winner and hasn't submitted their claim yet —
   * the drawer shows the winner splash → claim form → confirmation flow
   * instead of the dashboard. Takes precedence on open (even before the
   * email-capture gate — the claim is keyed to the account server-side).
   */
  | { kind: 'winnerClaim'; claim: PrizeClaimBlock };

/** Sub-screen of the winner claim flow (`state.kind === 'winnerClaim'`). */
export type WinnerClaimStep =
  | { kind: 'splash' }
  | { kind: 'form' }
  | { kind: 'confirmation'; claimNumber: string; submittedAt: string };

export interface V2ControllerDeps {
  api: WINRAPI;
  storage: LocalStorageProvider;
  bundleId: string;
  /** Cross-device adoption path (WINR.submitEmailAndAdopt). */
  submitEmailAndAdopt: (request: SubmitEmailRequest) => Promise<SubmitEmailResponse>;
  /** Whether the registration handshake produced a user_uid. */
  hasRegisteredUuid: () => boolean;
  /** Host-app-provided identity — prefills the winner claim form. */
  userPrefill?: { firstName?: string; lastName?: string; phone?: string };
  /** Warm-start data cached by WINR from device registration. */
  cachedGiveaway?: Giveaway | null;
  cachedSdkConfig?: SDKConfig | null;
  /** Lets WINR keep its instance caches (giveaway, claim state, RTD) in sync. */
  onGiveawayRefreshed?: (response: GetActiveGiveawayResponse) => void;
  /**
   * Resolves the effective SDK config (server overrides merged over client
   * branding). Called after each giveaway refresh.
   */
  resolveSdkConfig?: () => SDKConfig;
}

/** Non-PII "email submitted" flag key — shared with the auto-open engine. */
export function emailSubmittedStorageKey(bundleId: string): string {
  return `${WINR_CONSTANTS.STORAGE_KEYS.EMAIL_SUBMITTED}_${bundleId}`;
}

export class V2ExperienceController {
  public state: V2State = { kind: 'loading' };

  public giveaway: Giveaway | null;
  public sdkConfig: SDKConfig | null;
  public claimedToday = false;
  public streakDay = 1;
  public totalEntries = 0;
  public isSubmittingEmail = false;

  // ─── Day 2+ reveal flow ───
  //
  // The celebration is the dashboard's first visible frame: before entering
  // the dashboard state a PREDICTED grant is staged straight from the
  // pre-claim status response (predicted entries = the ladder value for the
  // streak day being claimed today), the reveal fires on first mount, and
  // the real claim runs in the BACKGROUND — its response reconciles the
  // totals/streak silently (no second celebration). The pill reads "GOT IT"
  // the whole time — there is no claim click.

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
  public onError?: (error: WINRError) => void;

  private previousState: V2State | null = null;
  /** One-shot guard for the "already claimed on another device" re-sync. */
  private didResyncAfterAlreadyClaimed = false;
  private isClaiming = false;

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
    return [...WINR_CONSTANTS.DEFAULT_STREAK_LADDER];
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

  // ─── Email consent gate ───

  private get emailSubmittedKey(): string {
    return emailSubmittedStorageKey(this.deps.bundleId);
  }

  private get giveawayCacheKey(): string {
    return WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY;
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

  // ─── State machine ───

  private transition(state: V2State): void {
    this.state = state;
    this.onChange?.(state);
  }

  public async load(): Promise<void> {
    let pendingPrizeClaim: PrizeClaimBlock | null = null;
    try {
      const response = await this.deps.api.getActiveGiveaway();
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
    } catch (error) {
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
    }

    // Winner prize claim takes precedence over the email gate and the
    // auto-claim/dashboard on open — the claim is keyed to the account
    // server-side, so it works even before the email-capture flow (and when
    // the giveaway is null). The daily auto-claim still fires silently in the
    // background so the winner's entries keep accruing.
    if (pendingPrizeClaim) {
      this.winnerClaimStep = { kind: 'splash' };
      this.transition({ kind: 'winnerClaim', claim: pendingPrizeClaim });
      analyticsAdapter.track('winr_winner_claim_shown', {
        giveaway_id: pendingPrizeClaim.giveawayId,
      });
      if (!this.claimedToday && this.hasEmailConsent) {
        void this.silentDailyClaim();
      }
      return;
    }

    // Email-capture gate: shown until the user completes the consent flow.
    if (!this.hasEmailConsent) {
      this.transition({ kind: 'emailCapture' });
      return;
    }

    // Day 2+ (an existing streak, unclaimed today): the celebration is the
    // dashboard's FIRST VISIBLE FRAME. Stage a PREDICTED grant from the
    // pre-claim response (no waiting on the claim round-trip), enter the
    // dashboard, arm the first-mount reveal, and reconcile with the real
    // claim in the background.
    if (!this.claimedToday && this.streakDay >= 1) {
      this.stagePredictedReveal();
      this.transition({ kind: 'dashboard' });
      this.scheduleAutoReveal();
      void this.reconcileClaimInBackground();
      return;
    }

    this.transition({ kind: 'dashboard' });

    // Day 1 (brand-new or restarted streak): entries are granted
    // automatically when the drawer opens — no tap required — and the
    // "You're in!" celebration modal is the reveal, so the claim is awaited.
    if (!this.claimedToday) {
      await this.autoClaim();
    }
  }

  /**
   * Stages the Day 2+ celebration from the PRE-claim status response alone:
   * today's claim advances the streak to `streakDay + 1`, so the predicted
   * grant is the ladder value for that day and the predicted total is
   * preTotal + predicted. The background claim reconciles both silently.
   */
  private stagePredictedReveal(): void {
    const preStreakDay = this.streakDay;
    const preTotal = this.totalEntries;
    this.preRevealSnapshot = { streakDay: preStreakDay, totalEntries: preTotal };

    const predictedDay = preStreakDay + 1;
    const predicted = this.ladderValue(predictedDay);
    this.pendingRevealGrant = { baseEntries: predicted, bonusEntries: 0 };
    this.claimRevealed = false;
    this.preClaimTotalEntries = preTotal;
    this.streakDay = predictedDay;
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
      const response = await this.deps.api.claimDailyEntries();

      let bonus = 0;
      if (response.weeklyBonusEntries) bonus += response.weeklyBonusEntries;
      if (response.monthlyBonusEntries) bonus += response.monthlyBonusEntries;
      if (response.milestone) bonus += response.milestone.bonusEntries;
      if (response.monthlyMilestone) bonus += response.monthlyMilestone.bonusEntries;

      this.claimedToday = true;
      this.streakDay = response.streakDay;
      this.totalEntries = response.totalEntries;
      this.pendingRevealGrant = { baseEntries: response.entries, bonusEntries: bonus };
      this.preClaimTotalEntries = response.totalEntries - (response.entries + bonus);
      this.preRevealSnapshot = null;

      analyticsAdapter.track('winr_daily_entry_claimed', {
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

      this.onRevealReconcile?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (/already claimed|already entered/i.test(message)) {
        // Another device claimed between the status fetch and our claim. Not
        // news worth celebrating twice: drop the predicted grant (cancelling
        // the reveal if it hasn't fired) and pull authoritative state ONCE.
        logger.info('Already claimed today — updating local state');
        this.claimedToday = true;
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

      // Other failures are SILENT by design: settle back to the pre-claim
      // server truth quietly. Never fake a local success.
      logger.info('Auto-claim declined:', error);
      this.claimedToday = false;
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
      this.streakDay = response.streakDay;
      this.totalEntries = response.totalEntries;

      analyticsAdapter.track('winr_daily_entry_claimed', {
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

      // V2 auto-claim routing (mirrors iOS commit 50cd438):
      // - Day 1 (brand-new or restarted streak, typically right after email
      //   capture): the "You're in!" celebration modal is the reveal.
      // - Day 2+: no modal, no claim click. Land on the dashboard pinned to
      //   yesterday's numbers; the in-place celebration fires on its own a
      //   beat later (Joe's Slice Day 2+ flow).
      if (response.streakDay <= 1) {
        this.transition({
          kind: 'celebration',
          baseEntries: response.entries,
          bonusEntries: bonus,
          totalEntries: response.totalEntries,
        });
      } else {
        this.pendingRevealGrant = { baseEntries: response.entries, bonusEntries: bonus };
        this.claimRevealed = false;
        this.preClaimTotalEntries = response.totalEntries - (response.entries + bonus);
        this.transition({ kind: 'dashboard' });
        // Armed HERE (not in the render): the claim response is what stages
        // the grant, and the dashboard may already have been on screen.
        this.scheduleAutoReveal();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // "Already claimed" means the user already got their entries today
      // (another device beat us between the status fetch and the claim). This
      // isn't news worth celebrating — show the dashboard in its claimed state,
      // then re-load ONCE to pull the authoritative streak/total.
      if (/already claimed|already entered/i.test(message)) {
        logger.info('Already claimed today — updating local state');
        this.claimedToday = true;
        this.transition({ kind: 'dashboard' });
        if (!this.didResyncAfterAlreadyClaimed) {
          this.didResyncAfterAlreadyClaimed = true;
          this.isClaiming = false;
          await this.load();
        }
        return;
      }

      // Auto-claim failures are SILENT by design: the dashboard simply shows
      // the unclaimed state. Never fake a local success for an auto-claim.
      logger.info('Auto-claim declined:', error);
      this.claimedToday = false;
      this.transition({ kind: 'dashboard' });
    } finally {
      this.isClaiming = false;
    }
  }

  // ─── Email capture ───

  public async submitEmail(email: string): Promise<void> {
    if (!email || this.isSubmittingEmail) return;
    this.isSubmittingEmail = true;
    this.onChange?.(this.state); // re-render the CTA into its loading state

    // NOTE: We deliberately do NOT persist the raw email locally (PII-High).
    // The backend stores it encrypted; registration state is derived from the
    // non-PII "submitted" flag + the handshake user_uid.
    this.deps.storage.setItem(this.emailSubmittedKey, 'true');

    try {
      // Cross-device streak unification: if this email already belonged to an
      // existing user under this publisher, submitEmailAndAdopt switches the
      // session to that canonical user's credentials.
      await this.deps.submitEmailAndAdopt({ email, marketingConsent: true });
      analyticsAdapter.track('winr_email_captured');
      logger.info('Email submitted to backend');
    } catch (error) {
      logger.error('Email submit to backend failed (will retry later):', error);
    } finally {
      this.isSubmittingEmail = false;
    }

    // Re-load so the (possibly switched) canonical user's authoritative
    // streak + claim status drive the UI (and the auto-claim fires).
    this.transition({ kind: 'loading' });
    await this.load();
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
        ...(form.story.trim() ? { story: form.story.trim() } : {}),
      });
      this.isSubmittingClaim = false;
      this.submittedClaimForm = form;
      this.winnerClaimStep = {
        kind: 'confirmation',
        claimNumber: response.claimNumber,
        submittedAt: response.submittedAt,
      };
      analyticsAdapter.track('winr_prize_claim_submitted', {
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
      this.claimSubmitError = 'Something went wrong. Please check your connection and try again.';
    }
  }

  // ─── Navigation ───

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
}

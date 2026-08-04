import {
  DailyEntryGrant,
  GetActiveGiveawayResponse,
  Giveaway,
  SDKConfig,
  SubmitEmailRequest,
  SubmitEmailResponse,
  WINRError,
  WINR_CONSTANTS,
} from '../../types';
import { WINRAPI } from '../../network/api';
import { LocalStorageProvider } from '../../storage/local-storage';
import { logger } from '../../services/logger';
import { analyticsAdapter } from '../../services/analytics';
import { ladderEntries } from './v2-theme';

/**
 * V2 experience state machine — ported from iOS WINRExperienceViewModel.
 *
 * Flow: loading → (emailCapture | dashboard) → auto-claim on open →
 * celebration on success / silent claimed-state on "Already claimed"
 * (with a ONE-SHOT re-sync so cached totals catch up when another device
 * claimed between the status fetch and our claim).
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
  | { kind: 'howItWorks' };

export interface V2ControllerDeps {
  api: WINRAPI;
  storage: LocalStorageProvider;
  bundleId: string;
  /** Cross-device adoption path (WINR.submitEmailAndAdopt). */
  submitEmailAndAdopt: (request: SubmitEmailRequest) => Promise<SubmitEmailResponse>;
  /** Whether the registration handshake produced a user_uid. */
  hasRegisteredUuid: () => boolean;
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
    try {
      const response = await this.deps.api.getActiveGiveaway();
      this.deps.onGiveawayRefreshed?.(response);

      // RTD: an opted-out person never sees the experience content.
      if (response.optedOut === true) {
        this.transition({ kind: 'empty' });
        return;
      }

      if (!response.giveaway) {
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

      this.deps.storage.setItem(this.giveawayCacheKey, JSON.stringify(response.giveaway));
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

    // Email-capture gate: shown until the user completes the consent flow.
    if (!this.hasEmailConsent) {
      this.transition({ kind: 'emailCapture' });
      return;
    }

    this.transition({ kind: 'dashboard' });

    // V2 experience: entries are granted automatically when the drawer opens —
    // no tap required. Registered + consented + not-yet-claimed → claim now.
    // Failures are silent (the dashboard just shows the claimed-less state).
    if (!this.claimedToday) {
      await this.autoClaim();
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

      // Celebration modal after every successful claim (explicit dismiss only).
      this.transition({
        kind: 'celebration',
        baseEntries: response.entries,
        bonusEntries: bonus,
        totalEntries: response.totalEntries,
      });
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

  /** The celebration modal's GOT IT — settle onto the dashboard. */
  public showDashboardAfterCelebration(): void {
    this.claimedToday = true;
    this.transition({ kind: 'dashboard' });
  }

  /** Close the whole experience (X buttons / GOT IT on the dashboard). */
  public requestDismiss(): void {
    this.onDismissRequest?.();
  }
}

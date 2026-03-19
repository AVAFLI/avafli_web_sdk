import {
  Giveaway,
  StreakState,
  SDKConfig,
  DailyEntryGrant,
  WINRError,
  WINRErrorCode,
} from '../../types';
import { GiveawayModel } from '../../domain/giveaway';
import { logger } from '../../services/logger';
import { StreakDashboard } from './streak-dashboard';
import { BonusEntriesScreen } from './bonus-entries';
import { HowItWorksScreen } from './how-it-works';
import { EmailCaptureScreen } from './email-capture';

/**
 * State machine matching iOS WINRExperienceViewModel.State
 */
type ExperienceState =
  | { kind: 'loading' }
  | { kind: 'noActiveGiveaway' }
  | { kind: 'emailCapture' }
  | { kind: 'streak'; claimedToday: boolean }
  | { kind: 'bonus'; baseEntries: number }
  | { kind: 'howItWorks' }
  | { kind: 'completed'; totalEntries: number }
  | { kind: 'error'; message: string };

interface ExperienceCallbacks {
  onComplete: (result: DailyEntryGrant) => void;
  onError: (error: WINRError) => void;
  onEmailRequired: () => void;
  onClose?: () => void;
  onShowInfo?: () => void;
  onHideInfo?: () => void;
}

/**
 * Main experience screen — matches iOS WINRExperienceView.swift
 * Implements state machine: loading → emailCapture → streak → bonus → completed
 */
export class ExperienceScreen {
  private element: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private callbacks?: ExperienceCallbacks;
  private giveawayModel: GiveawayModel | null = null;
  private state: ExperienceState = { kind: 'loading' };
  private previousState: ExperienceState | null = null;
  private isProcessing = false;

  // Track header update callback for modal
  public onHeaderUpdate?: (state: {
    showBack: boolean;
    showInfo: boolean;
  }) => void;

  constructor(
    private giveaway: Giveaway | null,
    private streakState: StreakState | null,
    private sdkConfig: SDKConfig | null,
    private claimedToday = false,
    private hasEmail = false,
    private publisherUserId?: string
  ) {
    this.giveawayModel = giveaway ? GiveawayModel.fromJSON(giveaway) : null;
  }

  public setCallbacks(callbacks: ExperienceCallbacks): void {
    this.callbacks = callbacks;
  }

  public render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'winr-experience-screen';

    // Content container (screens render into this)
    this.contentEl = document.createElement('div');
    this.contentEl.style.width = '100%';
    this.contentEl.style.height = '100%';
    this.element.appendChild(this.contentEl);

    // Start state machine
    if (!this.giveaway) {
      this.transitionTo({ kind: 'noActiveGiveaway' });
    } else if (!this.giveawayModel || !this.giveawayModel.isActive()) {
      this.transitionTo({ kind: 'noActiveGiveaway' });
    } else if (!this.hasEmail) {
      this.transitionTo({ kind: 'emailCapture' });
    } else if (!this.claimedToday) {
      this.transitionTo({ kind: 'streak', claimedToday: false });
    } else {
      this.transitionTo({ kind: 'streak', claimedToday: true });
    }

    return this.element;
  }

  /** Navigate to How It Works (called from header info button) */
  public showHowItWorks(): void {
    this.previousState = this.state;
    this.transitionTo({ kind: 'howItWorks' });
  }

  /** Navigate back from How It Works */
  public hideHowItWorks(): void {
    if (this.previousState) {
      this.transitionTo(this.previousState);
      this.previousState = null;
    }
  }

  // ── State machine ──

  private transitionTo(newState: ExperienceState): void {
    this.state = newState;
    this.renderState();
    this.notifyHeader();
  }

  private notifyHeader(): void {
    const isHowItWorks = this.state.kind === 'howItWorks';
    const infoAvailable = this.state.kind === 'streak' || this.state.kind === 'emailCapture';

    this.onHeaderUpdate?.({
      showBack: isHowItWorks,
      showInfo: infoAvailable && !isHowItWorks,
    });
  }

  private renderState(): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = '';

    switch (this.state.kind) {
      case 'loading':
        this.renderLoading();
        break;
      case 'noActiveGiveaway':
        this.renderNoActiveGiveaway();
        break;
      case 'emailCapture':
        this.renderEmailCapture();
        break;
      case 'streak':
        this.renderStreak(this.state.claimedToday);
        break;
      case 'bonus':
        this.renderBonus(this.state.baseEntries);
        break;
      case 'howItWorks':
        this.renderHowItWorks();
        break;
      case 'completed':
        this.renderCompleted(this.state.totalEntries);
        break;
      case 'error':
        this.renderError(this.state.message);
        break;
    }
  }

  // ── Renderers ──

  private renderLoading(): void {
    const loadingText = this.sdkConfig?.copy?.loading?.text ?? "Loading today's reward…";
    const el = document.createElement('div');
    el.className = 'winr-loading-state';
    el.innerHTML = `
      <div class="winr-loading-spinner"></div>
      <span class="winr-loading-text">${loadingText}</span>
    `;
    this.contentEl!.appendChild(el);
  }

  private renderNoActiveGiveaway(): void {
    const title = this.sdkConfig?.copy?.noActiveGiveaway?.title ?? 'No Active Giveaway';
    const subtitle = this.sdkConfig?.copy?.noActiveGiveaway?.subtitle ?? 'Check back soon for your next chance to win!';
    const closeText = this.sdkConfig?.copy?.noActiveGiveaway?.closeButton ?? 'Close';

    const el = document.createElement('div');
    el.className = 'winr-card-state winr-no-giveaway-state';
    
    // Publisher logo if available
    const logoUrl = this.sdkConfig?.branding?.logoUrl;
    if (logoUrl) {
      const logoEl = document.createElement('div');
      logoEl.className = 'winr-publisher-logo';
      logoEl.innerHTML = `<img src="${logoUrl}" alt="Publisher Logo" style="max-width: 120px; max-height: 60px; object-fit: contain;">`;
      el.appendChild(logoEl);
    }
    
    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    titleEl.className = 'winr-no-giveaway-title';
    el.appendChild(titleEl);
    
    const subtitleEl = document.createElement('p');
    subtitleEl.textContent = subtitle;
    subtitleEl.className = 'winr-no-giveaway-subtitle';
    el.appendChild(subtitleEl);
    
    const btn = document.createElement('button');
    btn.textContent = closeText;
    btn.className = 'winr-close-button';
    btn.addEventListener('click', () => this.callbacks?.onClose?.());
    el.appendChild(btn);
    
    this.contentEl!.appendChild(el);
  }

  private renderEmailCapture(): void {
    const screen = new EmailCaptureScreen(
      this.sdkConfig,
      this.giveaway,
      this.sdkConfig?.rulesUrl || this.giveaway?.rulesUrl,
      undefined, // prefillEmail
      this.publisherUserId
    );
    screen.setCallbacks({
      onSubmitted: () => {
        this.hasEmail = true;
        this.transitionTo({ kind: 'streak', claimedToday: false });
      },
      onError: (err) => this.callbacks?.onError(err),
    });
    this.contentEl!.appendChild(screen.render());
  }

  private renderStreak(claimedToday: boolean): void {
    if (!this.giveawayModel) return;

    const dashboard = new StreakDashboard(
      this.giveawayModel,
      this.streakState,
      this.sdkConfig
    );
    dashboard.setClaimedToday(claimedToday);
    dashboard.setCallbacks({
      onClaim: () => this.handleClaim(),
      onClose: () => this.callbacks?.onClose?.(),
    });
    this.contentEl!.appendChild(dashboard.render());
  }

  private renderBonus(baseEntries: number): void {
    const bonus = new BonusEntriesScreen(null, baseEntries, this.sdkConfig);
    bonus.setCallbacks({
      onBonusEarned: (entries) => {
        const total = (this.streakState?.totalEntriesEarned || 0) + baseEntries + entries;
        this.transitionTo({ kind: 'completed', totalEntries: total });
        this.callbacks?.onComplete({
          entries: baseEntries + entries,
          streakDay: this.streakState?.currentDay || 1,
          totalEntries: total,
        });
      },
      onClose: () => {
        const total = (this.streakState?.totalEntriesEarned || 0) + baseEntries;
        this.transitionTo({ kind: 'completed', totalEntries: total });
        this.callbacks?.onComplete({
          entries: baseEntries,
          streakDay: this.streakState?.currentDay || 1,
          totalEntries: total,
        });
      },
      onError: (err) => this.callbacks?.onError(err),
    });
    this.contentEl!.appendChild(bonus.render());
  }

  private renderHowItWorks(): void {
    const hiw = new HowItWorksScreen(this.sdkConfig);
    hiw.setCallbacks({
      onClose: () => this.hideHowItWorks(),
    });
    this.contentEl!.appendChild(hiw.render());
  }

  private renderCompleted(totalEntries: number): void {
    const title = this.sdkConfig?.copy?.completed?.title ?? "Entries Claimed!";
    const subtitle = (this.sdkConfig?.copy?.completed?.subtitle ?? "+{totalEntries} entries added to this month's drawing.")
      .replace("{totalEntries}", String(totalEntries));
    const closeText = this.sdkConfig?.copy?.completed?.closeButton ?? "Close";

    const el = document.createElement('div');
    el.className = 'winr-card-state';
    
    // Hero media
    this.renderHeroMedia(el, 'completed');
    
    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    el.appendChild(titleEl);
    
    const subtitleEl = document.createElement('p');
    subtitleEl.textContent = subtitle;
    el.appendChild(subtitleEl);
    
    const btn = document.createElement('button');
    btn.textContent = closeText;
    btn.addEventListener('click', () => this.callbacks?.onClose?.());
    el.appendChild(btn);
    this.contentEl!.appendChild(el);
  }

  private renderError(message: string): void {
    const title = this.sdkConfig?.copy?.error?.title ?? "Something went wrong.";
    const subtitle = this.sdkConfig?.copy?.error?.subtitle ?? (message || 'Please try again later.');
    const closeText = this.sdkConfig?.copy?.error?.closeButton ?? "Close";

    const el = document.createElement('div');
    el.className = 'winr-card-state';
    el.innerHTML = `
      <h2>${title}</h2>
      <p>${subtitle}</p>
    `;
    const btn = document.createElement('button');
    btn.textContent = closeText;
    btn.addEventListener('click', () => this.callbacks?.onClose?.());
    el.appendChild(btn);
    this.contentEl!.appendChild(el);
  }

  // ── Actions ──

  private async handleClaim(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      logger.debug('Claiming daily entries...');

      const currentDay = this.streakState?.currentDay || 1;
      const entries = this.giveawayModel?.getBaseEntries(currentDay) || 0;

      // TODO: Call backend API
      const result: DailyEntryGrant = {
        entries,
        streakDay: currentDay,
        totalEntries: (this.streakState?.totalEntriesEarned || 0) + entries,
      };

      this.claimedToday = true;

      // If bonus entries feature flag is on and giveaway has ads, go to bonus; otherwise complete
      if (this.sdkConfig?.bonusEntriesEnabled && this.giveawayModel?.hasAdsEnabled() && this.giveawayModel.doublingEnabled) {
        this.transitionTo({ kind: 'bonus', baseEntries: entries });
      } else {
        this.transitionTo({ kind: 'completed', totalEntries: result.totalEntries });
        this.callbacks?.onComplete(result);
      }
    } catch (error) {
      logger.error('Claim failed:', error);
      this.callbacks?.onError(
        new WINRError(
          WINRErrorCode.NetworkError,
          'Failed to claim entries. Please try again.',
          error instanceof Error ? error : undefined
        )
      );
    } finally {
      this.isProcessing = false;
    }
  }

  public renderMilestone(milestone: { day: number; bonusEntries: number; badge?: string }): void {
    const title = this.sdkConfig?.copy?.milestone?.title ?? `Milestone Achieved!`;
    const subtitle = (this.sdkConfig?.copy?.milestone?.subtitle ?? "You've reached day {day} and earned {bonusEntries} bonus entries!")
      .replace("{day}", String(milestone.day))
      .replace("{bonusEntries}", String(milestone.bonusEntries));
    const continueText = this.sdkConfig?.copy?.milestone?.continueButton ?? "Continue";

    const el = document.createElement('div');
    el.className = 'winr-card-state';
    
    // Hero media
    this.renderHeroMedia(el, 'milestone');
    
    const titleEl = document.createElement('h2');
    titleEl.textContent = title;
    el.appendChild(titleEl);
    
    const subtitleEl = document.createElement('p');
    subtitleEl.textContent = subtitle;
    el.appendChild(subtitleEl);
    
    if (milestone.badge) {
      const badgeEl = document.createElement('div');
      badgeEl.className = 'winr-milestone-badge';
      badgeEl.textContent = `Badge: ${milestone.badge}`;
      el.appendChild(badgeEl);
    }
    
    const btn = document.createElement('button');
    btn.textContent = continueText;
    btn.addEventListener('click', () => this.callbacks?.onClose?.());
    el.appendChild(btn);
    
    if (this.contentEl) {
      this.contentEl.innerHTML = '';
      this.contentEl.appendChild(el);
    }
  }

  private renderHeroMedia(containerElement: HTMLElement, screenType: 'milestone' | 'completed'): void {
    const media = this.sdkConfig?.media?.[screenType];
    if (!media) return;

    const heroWrap = document.createElement('div');
    heroWrap.className = 'winr-hero-media';

    if (media.lottieUrl) {
      // For future Lottie support, fallback to image for now
      const img = document.createElement('img');
      img.src = media.imageUrl || media.lottieUrl;
      img.alt = 'Hero Media';
      img.style.cssText = 'max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 12px;';
      heroWrap.appendChild(img);
    } else if (media.imageUrl) {
      const img = document.createElement('img');
      img.src = media.imageUrl;
      img.alt = 'Hero Image';
      img.style.cssText = 'max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 12px;';
      heroWrap.appendChild(img);
    }

    if (heroWrap.children.length > 0) {
      containerElement.appendChild(heroWrap);
    }
  }
}

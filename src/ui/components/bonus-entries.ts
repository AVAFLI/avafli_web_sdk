import { WINRError, WINRErrorCode, RewardedVideoProvider, SDKConfig } from '../../types';
import { logger } from '../../services/logger';
import { analyticsAdapter } from '../../services/analytics';
import { renderLottie } from '../lottie';

/**
 * Bonus entries screen — matches iOS BonusEntriesView.swift
 * Simple: title, description, "WATCH & CLAIM" button, skip text
 */
export class BonusEntriesScreen {
  private element: HTMLElement | null = null;
  private callbacks: {
    onBonusEarned?: (entries: number) => void;
    onError?: (error: WINRError) => void;
    onClose?: () => void;
  } = {};
  private isLoading = false;

  constructor(
    private rewardedVideoProvider: RewardedVideoProvider | null,
    private maxBonusEntries: number = 50,
    private sdkConfig: SDKConfig | null = null
  ) {}

  public setCallbacks(callbacks: {
    onBonusEarned?: (entries: number) => void;
    onError?: (error: WINRError) => void;
    onClose?: () => void;
  }): void {
    this.callbacks = callbacks;
  }

  public render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'winr-bonus-entries';
    this.buildUI();
    analyticsAdapter.track('winr_bonus_entries_viewed', {
      hasProvider: !!this.rewardedVideoProvider,
    });
    return this.element;
  }

  private buildUI(): void {
    if (!this.element) return;

    const entries = this.maxBonusEntries;

    // Hero media
    this.renderHeroMedia();

    // Title
    const titleText = this.sdkConfig?.copy?.bonusEntries?.title ?? 'BONUS ENTRIES';
    const title = document.createElement('h2');
    title.className = 'winr-bonus-title';
    title.textContent = titleText;

    // Description
    const subtitleTemplate = this.sdkConfig?.copy?.bonusEntries?.subtitle ?? 'Watch a short video to double today\'s {entries} entries.';
    const subtitleText = subtitleTemplate.replace('{entries}', String(entries));
    const desc = document.createElement('p');
    desc.className = 'winr-bonus-desc';
    desc.textContent = subtitleText;

    // Watch & Claim button
    const watchButtonTemplate = this.sdkConfig?.copy?.bonusEntries?.watchButton ?? 'WATCH & CLAIM {totalEntries} ENTRIES';
    const watchButtonText = watchButtonTemplate.replace('{totalEntries}', String(entries * 2));
    const claimBtn = document.createElement('button');
    claimBtn.className = 'winr-bonus-claim-btn';
    claimBtn.textContent = watchButtonText;
    claimBtn.addEventListener('click', () => this.handleWatch());

    // Skip button
    const skipTemplate = this.sdkConfig?.copy?.bonusEntries?.skipText ?? 'No thanks, continue with {entries} entries';
    const skipText = skipTemplate.replace('{entries}', String(entries));
    const skipBtn = document.createElement('button');
    skipBtn.className = 'winr-bonus-skip';
    skipBtn.textContent = skipText;
    skipBtn.addEventListener('click', () => {
      analyticsAdapter.track('winr_bonus_entries_skipped');
      this.callbacks.onClose?.();
    });

    this.element.appendChild(title);
    this.element.appendChild(desc);
    this.element.appendChild(claimBtn);
    this.element.appendChild(skipBtn);
  }

  private async handleWatch(): Promise<void> {
    if (!this.rewardedVideoProvider || this.isLoading) {
      // If no provider, just skip
      this.callbacks.onClose?.();
      return;
    }

    this.isLoading = true;
    analyticsAdapter.track('winr_rewarded_video_started');

    try {
      await this.rewardedVideoProvider.load();
      const result = await this.rewardedVideoProvider.show();

      if (result.success && result.reward) {
        const bonusEntries = Math.min(result.reward.amount || this.maxBonusEntries, this.maxBonusEntries);
        analyticsAdapter.track('winr_rewarded_video_completed', { bonusEntries });
        this.callbacks.onBonusEarned?.(bonusEntries);
      } else {
        this.isLoading = false;
        analyticsAdapter.track('winr_rewarded_video_failed', { reason: 'incomplete' });
      }
    } catch (error) {
      logger.error('Rewarded video error:', error);
      this.isLoading = false;
      this.callbacks.onError?.(
        new WINRError(
          WINRErrorCode.RewardedVideoUnavailable,
          'Failed to show rewarded video',
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private renderHeroMedia(): void {
    if (!this.element) return;
    
    const bonusMedia = this.sdkConfig?.media?.bonusEntries;
    if (!bonusMedia) return;

    const heroWrap = document.createElement('div');
    heroWrap.className = 'winr-hero-media';

    if (bonusMedia.lottieUrl && !bonusMedia.imageUrl) {
      const stage = document.createElement('div');
      stage.style.cssText = 'width: 200px; height: 150px; margin: 0 auto;';
      heroWrap.appendChild(stage);
      void renderLottie(stage, bonusMedia.lottieUrl);
    } else if (bonusMedia.imageUrl) {
      const img = document.createElement('img');
      img.src = bonusMedia.imageUrl;
      img.alt = 'Hero Image';
      img.style.cssText = 'max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 12px;';
      heroWrap.appendChild(img);
    }

    if (heroWrap.children.length > 0) {
      this.element.appendChild(heroWrap);
    }
  }
}

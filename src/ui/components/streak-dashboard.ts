import { Giveaway, StreakState, SDKConfig } from '../../types';
import { GiveawayModel } from '../../domain/giveaway';
import { StreakDayTile } from './streak-day-tile';

/**
 * Streak dashboard — matches iOS StreakDashboardView.swift
 * Hero logo + prize → horizontal scroll tiles → bonus progress → sticky footer
 */
export class StreakDashboard {
  private element: HTMLElement | null = null;
  private dayTiles: StreakDayTile[] = [];
  private giveawayModel: GiveawayModel = null!;
  private claimedToday = false;
  private onClaim?: () => void;
  private onClose?: () => void;

  constructor(
    giveaway: Giveaway,
    private streakState: StreakState | null,
    private sdkConfig: SDKConfig | null
  ) {
    this.giveawayModel = GiveawayModel.fromJSON(giveaway);
  }

  public setCallbacks(callbacks: {
    onClaim?: () => void;
    onClose?: () => void;
  }): void {
    this.onClaim = callbacks.onClaim;
    this.onClose = callbacks.onClose;
  }

  public setClaimedToday(claimed: boolean): void {
    this.claimedToday = claimed;
  }

  public render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'winr-streak-dashboard';
    this.buildUI();
    return this.element;
  }

  private formatPrize(value: number): string {
    return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' CASH';
  }

  private buildUI(): void {
    if (!this.element) return;
    this.element.innerHTML = '';

    const ladder = this.giveawayModel.streakLadder;
    const currentDay = this.streakState?.currentDay || 1;
    const entriesToday = this.giveawayModel.getBaseEntries(currentDay);

    // ── Scrollable content ──
    const scroll = document.createElement('div');
    scroll.className = 'winr-streak-scroll';

    // Headroom
    const spacer = document.createElement('div');
    spacer.style.height = '20px';
    scroll.appendChild(spacer);

    // Hero media or logo
    const hero = document.createElement('div');
    hero.className = 'winr-streak-hero';
    this.renderHeroMedia(hero);
    scroll.appendChild(hero);

    // Prize banner
    const banner = document.createElement('div');
    banner.className = 'winr-streak-prize-banner';
    const prizeTitle = document.createElement('h2');
    prizeTitle.className = 'winr-streak-prize-title';
    
    const prizeHeadline = this.sdkConfig?.copy?.streakDashboard?.prizeHeadline 
      ?? this.sdkConfig?.copy?.emailCapture?.prizeHeadline;
    prizeTitle.textContent = prizeHeadline 
      ?? (this.giveawayModel ? `WIN ${this.formatPrize(this.giveawayModel.prizeValue)}!` : 'WIN PRIZES!');
    
    const prizeSub = document.createElement('p');
    prizeSub.className = 'winr-streak-prize-subtitle';
    prizeSub.textContent = this.sdkConfig?.copy?.streakDashboard?.streakMessage
      ?? this.sdkConfig?.copy?.streakMessage
      ?? 'Keep your daily streak alive to unlock more entries.';
    banner.appendChild(prizeTitle);
    banner.appendChild(prizeSub);
    scroll.appendChild(banner);

    // Section label
    const upcomingLabel = this.sdkConfig?.copy?.streakDashboard?.upcomingLabel ?? 'Upcoming rewards';
    const label = document.createElement('div');
    label.className = 'winr-streak-section-label';
    label.textContent = upcomingLabel;
    scroll.appendChild(label);

    // Carousel
    const carousel = document.createElement('div');
    carousel.className = 'winr-streak-carousel';
    const row = document.createElement('div');
    row.className = 'winr-streak-tiles-row';

    this.dayTiles = [];
    for (let i = 0; i < ladder.length; i++) {
      const day = i + 1;
      const isClaimed = day < currentDay || (day === currentDay && this.claimedToday);
      const isToday = day === currentDay && !this.claimedToday;

      const tile = new StreakDayTile({
        day,
        entries: ladder[i] ?? 0,
        isCompleted: isClaimed,
        isCurrent: day === currentDay,
        isToday,
      });
      this.dayTiles.push(tile);
      row.appendChild(tile.render());
    }

    carousel.appendChild(row);
    scroll.appendChild(carousel);

    // NOTE: the weekly/monthly "Bonus Progress" section was intentionally removed —
    // those are the Phase-2 weekly/monthly streak fields that were suspended per the
    // 2/26 team call, and the native (iOS/Android/Flutter) SDKs no longer show them.

    this.element.appendChild(scroll);

    // ── Sticky footer ──
    const footer = document.createElement('div');
    footer.className = 'winr-streak-footer';

    if (this.claimedToday) {
      const claimedTitle = this.sdkConfig?.copy?.alreadyClaimed?.title ?? "Today's entries claimed!";
      const claimedSubtitle = this.sdkConfig?.copy?.alreadyClaimed?.subtitle ?? "Come back tomorrow to continue your streak.";
      const doneButtonText = this.sdkConfig?.copy?.alreadyClaimed?.doneButton ?? "Done";

      footer.innerHTML = `
        <div class="winr-claimed-icon">✅</div>
        <div class="winr-streak-footer-title">${claimedTitle}</div>
        <div class="winr-streak-footer-desc">${claimedSubtitle}</div>
      `;
      const doneBtn = document.createElement('button');
      doneBtn.className = 'winr-done-button';
      doneBtn.textContent = doneButtonText;
      doneBtn.addEventListener('click', () => this.onClose?.());
      footer.appendChild(doneBtn);
    } else {
      // The configured copy uses {day} (the canonical token iOS/Android/Flutter
      // all substitute); older copy used {currentDay}. Replace both so neither
      // leaks to the UI as a literal "Day {day} reward".
      const dayRewardLabel = (this.sdkConfig?.copy?.streakDashboard?.dayRewardLabel ?? "Day {day} reward")
        .replace("{currentDay}", String(currentDay))
        .replace("{day}", String(currentDay));
      const claimDescription = (this.sdkConfig?.copy?.streakDashboard?.claimDescription ?? "Claim {entriesToday} entries for today's visit to keep your streak alive.")
        .replace("{entriesToday}", String(entriesToday));
      const claimButtonText = this.sdkConfig?.copy?.streakDashboard?.claimButton 
        ?? this.sdkConfig?.copy?.dailyClaimButton 
        ?? `Claim ${entriesToday} Entries`;

      const ftTitle = document.createElement('div');
      ftTitle.className = 'winr-streak-footer-title';
      ftTitle.textContent = dayRewardLabel;

      const ftDesc = document.createElement('div');
      ftDesc.className = 'winr-streak-footer-desc';
      ftDesc.textContent = claimDescription;

      const claimBtn = document.createElement('button');
      claimBtn.className = 'winr-claim-button';
      claimBtn.textContent = claimButtonText;
      claimBtn.addEventListener('click', () => this.onClaim?.());

      footer.appendChild(ftTitle);
      footer.appendChild(ftDesc);
      footer.appendChild(claimBtn);
    }

    this.element.appendChild(footer);
  }

  private createBonusPill(
    label: string,
    current: number,
    target: number,
    bonus: number
  ): HTMLElement {
    const pill = document.createElement('div');
    pill.className = 'winr-bonus-pill';

    const pct = Math.min(100, (current / target) * 100);
    const earned = current >= target;

    const bonusEarnedText = this.sdkConfig?.copy?.streakDashboard?.bonusEarnedText ?? '✓ Bonus earned!';
    const entriesLabel = this.sdkConfig?.copy?.streakDashboard?.entriesLabel ?? 'entries';

    pill.innerHTML = `
      <div class="winr-bonus-pill-header">
        <span class="winr-bonus-pill-label">${label}</span>
        <span class="winr-bonus-pill-count">${current}/${target} days</span>
      </div>
      <div class="winr-bonus-pill-bar">
        <div class="winr-bonus-pill-fill" style="width: ${pct}%"></div>
      </div>
      <div class="winr-bonus-pill-footer ${earned ? 'earned' : 'pending'}">
        ${earned ? bonusEarnedText : `+${bonus} ${entriesLabel}`}
      </div>
    `;
    return pill;
  }

  // ── Public API (keep backward compatibility) ──

  public updateStreakState(newState: StreakState): void {
    this.streakState = newState;
    this.buildUI();
  }

  public animateClaimComplete(day: number): void {
    const tile = this.dayTiles[day - 1];
    if (tile) tile.animateCompletion();
  }

  public getCurrentDayEntries(): number {
    const currentDay = this.streakState?.currentDay || 1;
    return this.giveawayModel.getBaseEntries(currentDay);
  }

  public isStreakBroken(): boolean {
    if (!this.streakState?.lastClaimedDate) return false;
    const today = new Date();
    const lastClaim = this.streakState.lastClaimedDate;
    const daysDiff = Math.floor((today.getTime() - lastClaim.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff > 1;
  }

  public getStreakStats(): {
    currentDay: number;
    totalEntries: number;
    daysCompleted: number;
    canClaimToday: boolean;
    isStreakBroken: boolean;
  } {
    return {
      currentDay: this.streakState?.currentDay || 1,
      totalEntries: this.streakState?.totalEntriesEarned || 0,
      daysCompleted: this.dayTiles.filter(t => t.isCompleted()).length,
      canClaimToday: this.canClaimToday(),
      isStreakBroken: this.isStreakBroken(),
    };
  }

  private canClaimToday(): boolean {
    if (!this.streakState?.lastClaimedDate) return true;
    const today = new Date();
    const last = this.streakState.lastClaimedDate;
    return (
      today.getUTCFullYear() !== last.getUTCFullYear() ||
      today.getUTCMonth() !== last.getUTCMonth() ||
      today.getUTCDate() !== last.getUTCDate()
    );
  }

  private renderHeroMedia(heroElement: HTMLElement): void {
    const streakMedia = this.sdkConfig?.media?.streakDashboard;
    
    if (streakMedia?.lottieUrl) {
      // For future Lottie support, fallback to image for now
      const img = document.createElement('img');
      img.src = streakMedia.imageUrl || streakMedia.lottieUrl;
      img.alt = 'Hero Media';
      img.className = 'winr-streak-hero-logo';
      img.style.cssText = 'max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 12px;';
      heroElement.appendChild(img);
    } else if (streakMedia?.imageUrl) {
      const img = document.createElement('img');
      img.src = streakMedia.imageUrl;
      img.alt = 'Hero Image';
      img.className = 'winr-streak-hero-logo';
      img.style.cssText = 'max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 12px;';
      heroElement.appendChild(img);
    } else {
      // Fallback to branding logo
      const logoUrl = this.sdkConfig?.branding?.logoUrl;
      if (logoUrl) {
        const img = document.createElement('img');
        img.src = logoUrl;
        img.alt = 'Logo';
        img.className = 'winr-streak-hero-logo';
        heroElement.appendChild(img);
      }
    }
  }
}

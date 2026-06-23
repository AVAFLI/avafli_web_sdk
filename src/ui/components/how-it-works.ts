import { analyticsAdapter } from '../../services/analytics';
import { SDKConfig } from '../../types';
import { renderLottie } from '../lottie';

/**
 * How It Works screen — matches iOS HowItWorksView.swift
 * Numbered step rows, pro-tip card, sticky "Got It!" CTA with gradient fade
 */
export class HowItWorksScreen {
  private element: HTMLElement | null = null;
  private callbacks: {
    onClose?: () => void;
  } = {};

  constructor(private sdkConfig: SDKConfig | null = null) {}

  public setCallbacks(callbacks: { onClose?: () => void }): void {
    this.callbacks = callbacks;
  }

  public render(): HTMLElement {
    this.element = document.createElement('div');
    this.element.className = 'winr-how-it-works';
    this.buildUI();
    analyticsAdapter.track('winr_how_it_works_viewed');
    return this.element;
  }

  private buildUI(): void {
    if (!this.element) return;

    // Get copy from config with fallbacks
    const title = this.sdkConfig?.copy?.howItWorks?.title ?? 'How It Works';
    const subtitle = this.sdkConfig?.copy?.howItWorks?.subtitle ?? 'Earn entries every day for a chance to win big.';
    const step1Title = this.sdkConfig?.copy?.howItWorks?.step1Title ?? 'Visit Daily';
    const step1Desc = this.sdkConfig?.copy?.howItWorks?.step1Desc ?? 'Open the app each day to claim your daily entries.';
    const step2Title = this.sdkConfig?.copy?.howItWorks?.step2Title ?? 'Build Your Streak';
    const step2Desc = this.sdkConfig?.copy?.howItWorks?.step2Desc ?? 'Keep your streak alive — the longer it goes, the more entries you earn each day.';
    const step3Title = this.sdkConfig?.copy?.howItWorks?.step3Title ?? 'Watch & Double';
    const step3Desc = this.sdkConfig?.copy?.howItWorks?.step3Desc ?? 'Watch an optional short video to double your daily entries.';
    const step4Title = this.sdkConfig?.copy?.howItWorks?.step4Title ?? 'Win Prizes';
    const step4Desc = this.sdkConfig?.copy?.howItWorks?.step4Desc ?? 'Your entries go into the monthly prize drawing. More entries = better odds!';
    const tipText = this.sdkConfig?.copy?.howItWorks?.tipText ?? 'Pro tip: A 5-day streak earns a weekly bonus of extra entries!';
    const gotItText = this.sdkConfig?.copy?.howItWorks?.gotItButton ?? 'Got It!';

    const steps = [
      { icon: '📅', title: step1Title, desc: step1Desc },
      { icon: '🔥', title: step2Title, desc: step2Desc },
      { icon: '▶️', title: step3Title, desc: step3Desc },
      { icon: '🎁', title: step4Title, desc: step4Desc },
    ];

    // Scrollable content
    const scroll = document.createElement('div');
    scroll.className = 'winr-how-scroll';

    // Hero
    const hero = document.createElement('div');
    hero.className = 'winr-how-hero';
    
    // Hero media or default emoji
    this.renderHeroMedia(hero);
    
    const heroTitle = document.createElement('h2');
    heroTitle.className = 'winr-how-hero-title';
    heroTitle.textContent = title;
    
    const heroDesc = document.createElement('p');
    heroDesc.className = 'winr-how-hero-desc';
    heroDesc.textContent = subtitle;
    
    hero.appendChild(heroTitle);
    hero.appendChild(heroDesc);
    scroll.appendChild(hero);

    // Steps
    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'winr-how-steps';

    steps.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = 'winr-how-step';
      row.innerHTML = `
        <div class="winr-how-step-number">${index + 1}</div>
        <div class="winr-how-step-body">
          <div class="winr-how-step-header">
            <span class="winr-how-step-icon">${step.icon}</span>
            <h3 class="winr-how-step-title">${step.title}</h3>
          </div>
          <p class="winr-how-step-desc">${step.desc}</p>
        </div>
      `;
      stepsContainer.appendChild(row);
    });

    scroll.appendChild(stepsContainer);

    // Pro tip card
    const tip = document.createElement('div');
    tip.className = 'winr-how-tip';
    tip.innerHTML = `
      <span class="winr-how-tip-icon">💡</span>
      <p class="winr-how-tip-text">${tipText}</p>
    `;
    scroll.appendChild(tip);

    this.element.appendChild(scroll);

    // Sticky footer CTA
    const footer = document.createElement('div');
    footer.className = 'winr-how-footer';

    const btn = document.createElement('button');
    btn.className = 'winr-how-gotit-btn';
    btn.textContent = gotItText;
    btn.addEventListener('click', () => {
      analyticsAdapter.track('winr_how_it_works_closed');
      this.callbacks.onClose?.();
    });

    footer.appendChild(btn);
    this.element.appendChild(footer);
  }

  private renderHeroMedia(heroElement: HTMLElement): void {
    const howItWorksMedia = this.sdkConfig?.media?.howItWorks;
    
    if (howItWorksMedia?.lottieUrl && !howItWorksMedia.imageUrl) {
      const stage = document.createElement('div');
      stage.style.cssText = 'width: 200px; height: 150px; margin: 0 auto;';
      heroElement.appendChild(stage);
      void renderLottie(stage, howItWorksMedia.lottieUrl);
    } else if (howItWorksMedia?.imageUrl) {
      const img = document.createElement('img');
      img.src = howItWorksMedia.imageUrl;
      img.alt = 'Hero Image';
      img.className = 'winr-how-hero-emoji';
      img.style.cssText = 'max-width: 200px; max-height: 150px; object-fit: contain; border-radius: 12px;';
      heroElement.appendChild(img);
    } else {
      // Fallback to default emoji
      const emojiDiv = document.createElement('div');
      emojiDiv.className = 'winr-how-hero-emoji';
      emojiDiv.textContent = '🎰';
      heroElement.appendChild(emojiDiv);
    }
  }
}

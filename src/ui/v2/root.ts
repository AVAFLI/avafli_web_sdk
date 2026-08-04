import { DailyEntryGrant, PresentationOptions } from '../../types';
import { logger } from '../../services/logger';
import { V2ExperienceController, V2State } from './controller';
import {
  renderCapture,
  renderClaimConfirmation,
  renderClaimSteps,
  renderDashboard,
  renderEmpty,
  renderHowItWorks,
  renderLoading,
  renderWinnerModal,
  renderWinnerSplash,
} from './screens';
import { v2Styles } from './v2-styles';
import { accentAlpha, ensureV2Fonts, resolveAccent } from './v2-theme';

/**
 * Root of the V2 experience — the web equivalent of iOS WINRV2ExperienceRoot.
 *
 * Renders everything inside a SHADOW ROOT so host-page CSS can't break the
 * experience (and V2 CSS can't leak out). Responsive presentation:
 *  - < 768px: bottom drawer (flush to bottom/sides, top corners 30px, ~90%
 *    viewport height, dim backdrop, slide-up) — exactly like iOS.
 *  - >= 768px: the SAME content as a centered modal card (max-width ~440px,
 *    rounded 24px, scale/fade in). Handled purely in CSS (v2-styles.ts).
 */
export class WINRV2Experience {
  private host: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private sheet: HTMLElement | null = null;
  private modalHost: HTMLElement | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  private winnerOpen = false;

  // present() settlement: resolves with the grant when a claim succeeded, or
  // null when the user dismissed without one. Never rejects on plain dismissal.
  private settled = false;
  private resolvePresent?: (value: DailyEntryGrant | null) => void;
  private lastGrant: DailyEntryGrant | null = null;

  constructor(
    private controller: V2ExperienceController,
    private options: PresentationOptions = {}
  ) {}

  /** Mount + animate in, then run the controller's load/auto-claim flow. */
  public present(container?: HTMLElement): Promise<DailyEntryGrant | null> {
    return new Promise((resolve) => {
      this.resolvePresent = resolve;
      ensureV2Fonts();
      this.mount(container);

      this.controller.onChange = (state) => this.renderState(state);
      this.controller.onDismissRequest = () => this.dismiss();
      this.controller.onComplete = (grant) => {
        this.lastGrant = grant;
        this.options.onComplete?.(grant);
      };

      this.renderState(this.controller.state);
      void this.controller.load();
    });
  }

  public dismiss(): void {
    if (!this.host || !this.overlay) return;
    logger.debug('Dismissing WINR V2 experience');
    // A pending Day 2+ auto-reveal must not fire against a torn-down DOM.
    this.controller.cancelAutoReveal();
    this.overlay.classList.remove('wv2-open');
    this.overlay.classList.add('wv2-closing');
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
    const host = this.host;
    this.host = null;
    setTimeout(() => {
      host.remove();
      if (!this.settled) {
        this.settled = true;
        this.resolvePresent?.(this.lastGrant);
      }
      this.options.onClose?.();
    }, 400);
  }

  // ─── Mounting ───

  private mount(container?: HTMLElement): void {
    const host = document.createElement('div');
    host.setAttribute('data-winr', 'v2');
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = v2Styles();
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'wv2-overlay';
    this.applyAccent(overlay);

    const backdrop = document.createElement('div');
    backdrop.className = 'wv2-backdrop';
    backdrop.addEventListener('click', () => this.dismiss());
    overlay.appendChild(backdrop);

    const sheet = document.createElement('div');
    sheet.className = 'wv2-sheet';
    overlay.appendChild(sheet);

    const modalHost = document.createElement('div');
    overlay.appendChild(modalHost);

    shadow.appendChild(overlay);

    if (container) {
      overlay.classList.add('wv2-inline');
      const position = getComputedStyle(container).position;
      if (position === 'static') container.style.position = 'relative';
      container.appendChild(host);
    } else {
      document.body.appendChild(host);
    }

    this.host = host;
    this.overlay = overlay;
    this.sheet = sheet;
    this.modalHost = modalHost;

    // Animate in on the next frame so the initial transform applies first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add('wv2-open'));
    });

    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (this.winnerOpen) {
        this.closeWinnerModal();
        return;
      }
      this.dismiss();
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  /** Publisher accent (branding.primaryColor) + pre-computed alpha variants. */
  private applyAccent(overlay: HTMLElement): void {
    const accent = resolveAccent(this.controller.sdkConfig?.branding?.primaryColor);
    overlay.style.setProperty('--wv2-accent', accent);
    overlay.style.setProperty('--wv2-accent-95', accentAlpha(accent, 0.95));
    overlay.style.setProperty('--wv2-accent-75', accentAlpha(accent, 0.75));
    overlay.style.setProperty('--wv2-accent-55', accentAlpha(accent, 0.55));
    overlay.style.setProperty('--wv2-accent-45', accentAlpha(accent, 0.45));
    overlay.style.setProperty('--wv2-accent-35', accentAlpha(accent, 0.35));
  }

  // ─── State rendering ───

  private renderState(state: V2State): void {
    if (!this.sheet || !this.modalHost || !this.overlay) return;

    // The sdkConfig (branding) may only arrive with the load() response.
    this.applyAccent(this.overlay);
    const logoUrl = this.controller.sdkConfig?.branding?.logoUrl;

    this.sheet.innerHTML = '';
    this.modalHost.innerHTML = '';
    this.winnerOpen = false;

    const c = this.controller;
    switch (state.kind) {
      case 'loading':
        this.sheet.appendChild(renderLoading());
        break;
      case 'empty':
        this.sheet.appendChild(renderEmpty(() => this.dismiss()));
        break;
      case 'emailCapture':
        this.sheet.appendChild(renderCapture(c, logoUrl));
        break;
      case 'dashboard':
        // Every celebration (Day 1 included) is the dashboard's own
        // first-frame in-place reveal — there is no celebration modal.
        this.sheet.appendChild(renderDashboard(c, logoUrl, () => this.openWinnerModal()));
        break;
      case 'howItWorks':
        this.sheet.appendChild(renderHowItWorks(c, logoUrl));
        break;
      case 'winnerClaim': {
        // Winner prize-claim flow: splash → stepped form (4 steps + review) →
        // confirmation, routed by the controller's winnerClaimStep sub-state
        // (mirrors iOS WINRV2WinnerClaimFlow).
        const step = c.winnerClaimStep;
        if (step.kind === 'splash') {
          this.sheet.appendChild(renderWinnerSplash(c, state.claim, logoUrl));
        } else if (step.kind === 'form') {
          this.sheet.appendChild(renderClaimSteps(c, state.claim, logoUrl));
        } else {
          this.sheet.appendChild(
            renderClaimConfirmation(c, step.claimNumber, step.submittedAt, logoUrl)
          );
        }
        break;
      }
    }
  }

  private openWinnerModal(): void {
    const winner = this.controller.giveaway?.latestWinner;
    if (!winner || !this.modalHost) return;
    this.winnerOpen = true;
    this.modalHost.appendChild(renderWinnerModal(winner, () => this.closeWinnerModal()));
  }

  private closeWinnerModal(): void {
    if (!this.modalHost) return;
    this.winnerOpen = false;
    this.modalHost.innerHTML = '';
  }
}

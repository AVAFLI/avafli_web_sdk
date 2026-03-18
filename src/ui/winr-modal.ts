import {
  Giveaway,
  DailyEntryGrant,
  WINRError,
  WINRErrorCode,
  Theme,
  PresentationOptions,
  StreakState,
  SDKConfig,
} from '../types';
import { createTheme } from './theme';
import { injectStyles } from './styles';
import { logger } from '../services/logger';
import { ExperienceScreen } from './components/experience-screen';

/**
 * Main WINR modal — matches iOS WINRExperienceView.swift
 *
 * Layout (ZStack):
 *   backgroundLayer  (linear gradient + radial glow)
 *   content          (state-machine-driven screens)
 *   header overlay   (circular icon buttons: back/info left, close right)
 */
export class WINRModal {
  private element: HTMLElement | null = null;
  private theme: Theme;
  private cleanupStyles?: () => void;
  private experienceScreen?: ExperienceScreen;

  // Header button references
  private leftBtn: HTMLButtonElement | null = null;
  private leftSpacer: HTMLDivElement | null = null;

  constructor(
    private giveaway: Giveaway | null,
    private streakState: StreakState | null,
    private sdkConfig: SDKConfig | null,
    private options: PresentationOptions = {},
    private claimedToday = false,
    private hasEmail = false,
    private publisherUserId?: string
  ) {
    this.theme = createTheme(this.sdkConfig?.branding);
  }

  public async present(): Promise<DailyEntryGrant> {
    return new Promise((resolve, reject) => {
      try {
        this.show(resolve, reject);
      } catch (error) {
        reject(new WINRError(
          WINRErrorCode.InvalidState,
          'Failed to present modal',
          error instanceof Error ? error : undefined
        ));
      }
    });
  }

  public async presentInline(containerId: string): Promise<DailyEntryGrant> {
    return new Promise((resolve, reject) => {
      try {
        const container = document.getElementById(containerId);
        if (!container) {
          reject(new WINRError(
            WINRErrorCode.InvalidState,
            `Container element with ID "${containerId}" not found`
          ));
          return;
        }
        this.showInline(container, resolve, reject);
      } catch (error) {
        reject(new WINRError(
          WINRErrorCode.InvalidState,
          'Failed to present inline modal',
          error instanceof Error ? error : undefined
        ));
      }
    });
  }

  public dismiss(): void {
    if (!this.element) return;
    logger.debug('Dismissing WINR modal');

    const modal = this.element.querySelector('.winr-modal') as HTMLElement;
    if (modal) modal.classList.add('winr-modal-exit');

    setTimeout(() => {
      this.cleanup();
      this.options.onClose?.();
    }, 250);
  }

  // ── Build ──

  private show(
    resolve: (value: DailyEntryGrant) => void,
    reject: (reason?: unknown) => void
  ): void {
    this.cleanupStyles = injectStyles(this.theme);
    this.element = this.createOverlay(resolve, reject);
    document.body.appendChild(this.element);
    logger.debug('WINR modal presented');
  }

  private showInline(
    container: HTMLElement,
    resolve: (value: DailyEntryGrant) => void,
    reject: (reason?: unknown) => void
  ): void {
    this.cleanupStyles = injectStyles(this.theme);
    this.element = this.createModal(resolve, reject);
    container.appendChild(this.element);
    logger.debug('WINR modal presented inline');
  }

  private createOverlay(
    resolve: (value: DailyEntryGrant) => void,
    reject: (reason?: unknown) => void
  ): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'winr-modal-overlay';

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        reject(new WINRError(WINRErrorCode.InvalidState, 'Modal dismissed by user'));
        this.dismiss();
      }
    });

    const modal = this.createModal(resolve, reject);
    overlay.appendChild(modal);
    return overlay;
  }

  private createModal(
    resolve: (value: DailyEntryGrant) => void,
    reject: (reason?: unknown) => void
  ): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'winr-modal';

    // ── Background layer (ZStack) ──
    const bg = document.createElement('div');
    bg.className = 'winr-experience-bg';
    modal.appendChild(bg);

    const glow = document.createElement('div');
    glow.className = 'winr-experience-glow';
    modal.appendChild(glow);

    // ── Content area ──
    const content = document.createElement('div');
    content.className = 'winr-modal-content';

    this.experienceScreen = new ExperienceScreen(
      this.giveaway,
      this.streakState,
      this.sdkConfig,
      this.claimedToday,
      this.hasEmail,
      this.publisherUserId
    );

    this.experienceScreen.setCallbacks({
      onComplete: (result) => {
        logger.debug('Experience completed:', result);
        this.options.onComplete?.(result);
        resolve(result);
      },
      onError: (error) => {
        logger.error('Experience error:', error);
        this.options.onError?.(error);
        reject(error);
      },
      onEmailRequired: () => {
        logger.debug('Email capture required');
      },
      onClose: () => {
        this.dismiss();
      },
    });

    // Header update callback
    this.experienceScreen.onHeaderUpdate = (state) => {
      this.updateHeaderButtons(state.showBack, state.showInfo);
    };

    content.appendChild(this.experienceScreen.render());
    modal.appendChild(content);

    // ── Header overlay (iOS: .overlay at top) ──
    const header = this.createHeader(reject);
    modal.appendChild(header);

    // Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        reject(new WINRError(WINRErrorCode.InvalidState, 'Modal dismissed by user'));
        this.dismiss();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    return modal;
  }

  private createHeader(reject: (reason?: unknown) => void): HTMLElement {
    const header = document.createElement('div');
    header.className = 'winr-header-overlay';

    // Left: info/back button OR spacer
    this.leftSpacer = document.createElement('div');
    this.leftSpacer.className = 'winr-header-spacer';

    this.leftBtn = document.createElement('button');
    this.leftBtn.className = 'winr-header-icon';
    this.leftBtn.textContent = '?';
    this.leftBtn.style.display = 'none';
    this.leftBtn.addEventListener('click', () => {
      if (this.leftBtn?.dataset['mode'] === 'back') {
        this.experienceScreen?.hideHowItWorks();
      } else {
        this.experienceScreen?.showHowItWorks();
      }
    });

    const leftContainer = document.createElement('div');
    leftContainer.appendChild(this.leftSpacer);
    leftContainer.appendChild(this.leftBtn);
    header.appendChild(leftContainer);

    // Right: close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'winr-header-icon';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => {
      reject(new WINRError(WINRErrorCode.InvalidState, 'Modal dismissed by user'));
      this.dismiss();
    });
    header.appendChild(closeBtn);

    return header;
  }

  private updateHeaderButtons(showBack: boolean, showInfo: boolean): void {
    if (!this.leftBtn || !this.leftSpacer) return;

    if (showBack) {
      this.leftBtn.textContent = '‹';
      this.leftBtn.dataset['mode'] = 'back';
      this.leftBtn.style.display = 'flex';
      this.leftSpacer.style.display = 'none';
    } else if (showInfo) {
      this.leftBtn.textContent = '?';
      this.leftBtn.dataset['mode'] = 'info';
      this.leftBtn.style.display = 'flex';
      this.leftSpacer.style.display = 'none';
    } else {
      this.leftBtn.style.display = 'none';
      this.leftSpacer.style.display = 'block';
    }
  }

  private cleanup(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    if (this.cleanupStyles) {
      this.cleanupStyles();
      this.cleanupStyles = undefined;
    }
    logger.debug('WINR modal cleaned up');
  }
}

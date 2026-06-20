import { logger } from '../services/logger';

// lottie-web is lazy-loaded from a CDN the first time a Lottie animation needs to
// render, so the core SDK bundle stays small (publishers without media pay nothing).
// If the library or the animation fails to load we degrade gracefully — the caller
// can fall back to a static image. This mirrors the native SDKs, which render the
// publisher/admin-configured Lottie on every screen.
const LOTTIE_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';

interface LottiePlayer {
  loadAnimation(params: {
    container: Element;
    renderer: 'svg' | 'canvas' | 'html';
    loop: boolean;
    autoplay: boolean;
    path: string;
  }): { destroy: () => void };
}

declare global {
  interface Window {
    lottie?: LottiePlayer;
  }
}

let loadPromise: Promise<LottiePlayer | null> | null = null;

function loadLottieLib(): Promise<LottiePlayer | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.lottie) return Promise.resolve(window.lottie);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-winr-lottie]');
    const onReady = () => resolve(window.lottie ?? null);
    if (existing) {
      existing.addEventListener('load', onReady);
      existing.addEventListener('error', () => resolve(null));
      if (window.lottie) resolve(window.lottie);
      return;
    }
    const s = document.createElement('script');
    s.src = LOTTIE_CDN;
    s.async = true;
    s.dataset['winrLottie'] = 'true';
    s.onload = onReady;
    s.onerror = () => {
      logger.warn('Lottie library failed to load — falling back to static media');
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/**
 * Render a Lottie animation from a URL into `container`. Resolves to true when the
 * animation is playing, false if it couldn't load (so the caller can fall back to
 * an image). Never throws.
 */
export async function renderLottie(container: Element, url: string): Promise<boolean> {
  try {
    const lib = await loadLottieLib();
    if (!lib) return false;
    lib.loadAnimation({
      container,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: url,
    });
    return true;
  } catch (e) {
    logger.warn('Failed to render Lottie animation:', e);
    return false;
  }
}

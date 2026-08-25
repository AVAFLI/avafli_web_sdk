// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  V2ControllerDeps,
  V2ExperienceController,
  withAppParam,
} from '../src/ui/v2/controller';
import {
  LEGAL_IFRAME_TIMEOUT_MS,
  renderLegalLinks,
  renderLegalOverlay,
} from '../src/ui/v2/screens';
import { AvafliV2Strings } from '../src/ui/v2/strings';
import { Giveaway, AVAFLI_CONSTANTS } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * The in-experience legal overlay (2.9.5): Official Rules / Privacy Policy
 * open in an iframe INSIDE the drawer/lightbox instead of a new tab, and
 * "Delete my data" lives INSIDE the privacy page (loaded with `?app=1`),
 * which posts `{ type: "winr-delete" }` back to the SDK via postMessage.
 *
 * The bridge is deliberately paranoid: it accepts ONLY events whose origin
 * is exactly https://winrmedia.com AND whose data is `{ type: "winr-delete" }`,
 * and only while the overlay is open (the listener detaches on close).
 */

const GIVEAWAY: Giveaway = {
  id: 'g1',
  title: 'Test Giveaway',
  prizeDescription: 'Cash Prize',
  prizeValue: 1000,
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2027-01-01T00:00:00Z',
  streakLadder: [10, 30, 60, 130, 240, 300],
  doublingEnabled: false,
  maxDailyBaseEntries: 300,
  rulesUrl: 'https://example.com/rules?campaign=summer',
  milestones: [],
};

function fakeStorage(): LocalStorageProvider {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

function makeController(giveaway: Giveaway | null = GIVEAWAY): V2ExperienceController {
  const deps: V2ControllerDeps = {
    api: {} as unknown as AvafliAPI,
    storage: fakeStorage(),
    bundleId: 'com.test',
    submitEmailAndAdopt: vi.fn(),
    hasRegisteredUuid: () => true,
  };
  const controller = new V2ExperienceController(deps);
  controller.giveaway = giveaway;
  return controller;
}

function postToBridge(origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

const open = new Set<V2ExperienceController>();
afterEach(() => {
  // Never leak a window message listener between tests.
  for (const c of open) c.closeLegalOverlay();
  open.clear();
});

function opened(c: V2ExperienceController): V2ExperienceController {
  open.add(c);
  return c;
}

describe('withAppParam — privacy URL construction', () => {
  it('appends ?app=1 to a bare URL', () => {
    expect(withAppParam('https://winrmedia.com/sdk/privacy')).toBe(
      'https://winrmedia.com/sdk/privacy?app=1'
    );
  });

  it('extends an existing query string instead of adding a second "?"', () => {
    expect(withAppParam('https://winrmedia.com/sdk/privacy?lang=en')).toBe(
      'https://winrmedia.com/sdk/privacy?lang=en&app=1'
    );
  });

  it('leaves an unparseable URL untouched', () => {
    expect(withAppParam('not a url')).toBe('not a url');
  });
});

describe('showLegalOverlay — routing and URLs', () => {
  it('privacy opens PRIVACY_URL with ?app=1, and falls back to the plain URL', () => {
    const c = opened(makeController());
    c.showLegalOverlay('privacy');
    expect(c.legalOverlay).toEqual({
      doc: 'privacy',
      title: 'Privacy Policy',
      url: withAppParam(AVAFLI_CONSTANTS.PRIVACY_URL),
      fallbackUrl: AVAFLI_CONSTANTS.PRIVACY_URL,
    });
    expect(c.legalOverlay?.url).toContain('app=1');
    // The new-tab fallback has no parent to bridge to — no ?app=1 there.
    expect(c.legalOverlay?.fallbackUrl).not.toContain('app=1');
  });

  it('rules opens rulesUrl verbatim (no app param)', () => {
    const c = opened(makeController());
    c.showLegalOverlay('rules');
    expect(c.legalOverlay?.title).toBe('Official Rules');
    expect(c.legalOverlay?.url).toBe(GIVEAWAY.rulesUrl);
    expect(c.legalOverlay?.fallbackUrl).toBe(GIVEAWAY.rulesUrl);
  });

  it('rules without a configured rulesUrl is a no-op', () => {
    const c = makeController(null);
    c.showLegalOverlay('rules');
    expect(c.legalOverlay).toBeNull();
  });

  it('open and close notify onChange so the root re-renders', () => {
    const c = opened(makeController());
    const changed = vi.fn();
    c.onChange = changed;
    c.showLegalOverlay('privacy');
    expect(changed).toHaveBeenCalledTimes(1);
    c.closeLegalOverlay();
    expect(c.legalOverlay).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    // Closing again is a safe no-op (no spurious render).
    c.closeLegalOverlay();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe('delete bridge — postMessage filtering', () => {
  it('accepts { type: "winr-delete" } from https://winrmedia.com: closes the overlay and raises the confirmation', () => {
    const c = opened(makeController());
    c.showLegalOverlay('privacy');
    postToBridge('https://winrmedia.com', { type: 'winr-delete' });
    expect(c.legalOverlay).toBeNull();
    expect(c.optOutPhase).toBe('confirming');
  });

  it('accepts the rebranded { type: "avafli-delete" } from https://winrmedia.com (3.0)', () => {
    const c = opened(makeController());
    c.showLegalOverlay('privacy');
    postToBridge('https://winrmedia.com', { type: 'avafli-delete' });
    expect(c.legalOverlay).toBeNull();
    expect(c.optOutPhase).toBe('confirming');
  });

  it('rejects the right payload from the wrong origin', () => {
    const c = opened(makeController());
    c.showLegalOverlay('privacy');
    postToBridge('https://evil.example', { type: 'winr-delete' });
    postToBridge('https://evil.example', { type: 'avafli-delete' });
    postToBridge('https://winrmedia.com.evil.example', { type: 'winr-delete' });
    postToBridge('http://winrmedia.com', { type: 'winr-delete' });
    expect(c.legalOverlay).not.toBeNull();
    expect(c.optOutPhase).toBe('idle');
  });

  it('rejects the right origin with the wrong shape', () => {
    const c = opened(makeController());
    c.showLegalOverlay('privacy');
    postToBridge('https://winrmedia.com', { type: 'winr-delete-everything' });
    postToBridge('https://winrmedia.com', 'winr-delete');
    postToBridge('https://winrmedia.com', null);
    postToBridge('https://winrmedia.com', 42);
    expect(c.legalOverlay).not.toBeNull();
    expect(c.optOutPhase).toBe('idle');
  });

  it('ignores messages once the overlay is closed (listener removed)', () => {
    const c = makeController();
    c.showLegalOverlay('privacy');
    c.closeLegalOverlay();
    postToBridge('https://winrmedia.com', { type: 'winr-delete' });
    expect(c.optOutPhase).toBe('idle');
  });

  it('works from the rules overlay too (one bridge for the whole overlay)', () => {
    // Not the expected path — rules pages don't carry the delete section —
    // but the bridge is scoped to "overlay open", not to the privacy doc.
    const c = opened(makeController());
    c.showLegalOverlay('rules');
    postToBridge('https://winrmedia.com', { type: 'winr-delete' });
    expect(c.legalOverlay).toBeNull();
    expect(c.optOutPhase).toBe('confirming');
  });
});

describe('legal links route into the overlay (no window.open)', () => {
  it('the legal links row opens rules / privacy overlays instead of new tabs', () => {
    const c = opened(makeController());
    const openSpy = vi.spyOn(window, 'open');
    const links = renderLegalLinks(c);
    const anchors = links.querySelectorAll('.wv2-legal-row a');
    expect(anchors.length).toBe(2);

    (anchors[0] as HTMLAnchorElement).click();
    expect(c.legalOverlay?.doc).toBe('rules');
    c.closeLegalOverlay();

    (anchors[1] as HTMLAnchorElement).click();
    expect(c.legalOverlay?.doc).toBe('privacy');
    expect(c.legalOverlay?.url).toContain('app=1');
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('hrefs remain the real destinations for context-menu open-in-new-tab', () => {
    const c = makeController();
    const links = renderLegalLinks(c);
    const anchors = links.querySelectorAll<HTMLAnchorElement>('.wv2-legal-row a');
    expect(anchors[0].getAttribute('href')).toBe(GIVEAWAY.rulesUrl);
    expect(anchors[1].getAttribute('href')).toBe(AVAFLI_CONSTANTS.PRIVACY_URL);
  });
});

describe('renderLegalOverlay — iframe, loading veil, fallback', () => {
  it('renders the header title, the iframe at the overlay URL, and a loading veil', () => {
    const c = opened(makeController());
    c.showLegalOverlay('privacy');
    const layer = renderLegalOverlay(c);
    expect(layer.querySelector('.wv2-legal-overlay-title')?.textContent).toBe('Privacy Policy');
    const frame = layer.querySelector<HTMLIFrameElement>('.wv2-legal-overlay-frame');
    expect(frame?.getAttribute('src')).toBe(withAppParam(AVAFLI_CONSTANTS.PRIVACY_URL));
    expect(layer.querySelector('.wv2-legal-overlay-veil .wv2-spinner')).not.toBeNull();
  });

  it('the X closes the overlay', () => {
    const c = opened(makeController());
    c.showLegalOverlay('rules');
    const layer = renderLegalOverlay(c);
    layer.querySelector<HTMLButtonElement>('[aria-label="Close"]')?.click();
    expect(c.legalOverlay).toBeNull();
  });

  it('the veil disappears once the iframe loads', () => {
    vi.useFakeTimers();
    try {
      const c = opened(makeController());
      c.showLegalOverlay('privacy');
      const layer = renderLegalOverlay(c);
      const frame = layer.querySelector<HTMLIFrameElement>('.wv2-legal-overlay-frame');
      frame?.dispatchEvent(new Event('load'));
      expect(layer.querySelector('.wv2-legal-overlay-veil')).toBeNull();
      // A late timeout must not resurrect the fallback.
      vi.advanceTimersByTime(LEGAL_IFRAME_TIMEOUT_MS + 1);
      expect(layer.querySelector('.wv2-legal-overlay-fallback-link')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a load that never lands swaps the veil to the "Open in new tab" fallback', () => {
    vi.useFakeTimers();
    try {
      const c = opened(makeController());
      c.showLegalOverlay('privacy');
      const layer = renderLegalOverlay(c);
      vi.advanceTimersByTime(LEGAL_IFRAME_TIMEOUT_MS + 1);
      expect(layer.querySelector('.wv2-legal-overlay-fallback-text')?.textContent).toBe(
        AvafliV2Strings.legalOverlayLoadFailed
      );
      const link = layer.querySelector<HTMLAnchorElement>('.wv2-legal-overlay-fallback-link');
      expect(link?.textContent).toBe(AvafliV2Strings.legalOverlayOpenInTab);
      // The fallback opens the PLAIN privacy URL — outside the experience
      // there is no parent for the delete section to bridge to.
      expect(link?.getAttribute('href')).toBe(AVAFLI_CONSTANTS.PRIVACY_URL);
      expect(link?.target).toBe('_blank');
      expect(link?.rel).toContain('noopener');
    } finally {
      vi.useRealTimers();
    }
  });
});

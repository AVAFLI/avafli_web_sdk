// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { V2ExperienceController, V2ControllerDeps } from '../src/ui/v2/controller';
import { renderDashboard, renderLoading, startComeBackToast } from '../src/ui/v2/screens';
import { GetActiveGiveawayResponse, Giveaway, AVAFLI_CONSTANTS } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * Cache-first render (2.3.3).
 *
 * The drawer auto-opens AHEAD of its sequential network calls
 * (registerDevice → getActiveGiveaway → claim). When the device already has a
 * cached giveaway + persisted streak AND the user has consented, the real
 * dashboard is painted IMMEDIATELY from that cache and the fresh response
 * reconciles in place. Everything else — cold cache, unconsented user, a
 * phase already resolved by the network — falls back to the cold-start
 * SKELETON (or email capture), never a cached dashboard.
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
  rulesUrl: 'https://example.com/rules',
  milestones: [],
};

const BUNDLE = 'com.test';
const EMAIL_KEY = `${AVAFLI_CONSTANTS.STORAGE_KEYS.EMAIL_SUBMITTED}_${BUNDLE}`;
const GIVEAWAY_KEY = AVAFLI_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY;
const STREAK_KEY = AVAFLI_CONSTANTS.STORAGE_KEYS.STREAK_STATE;

function fakeStorage(seed: Record<string, string> = {}): LocalStorageProvider {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

/** Storage of a returning, consented user with a 4-day streak. */
function warmStorage(
  overrides: { emailSubmitted?: boolean; lastClaimedDate?: string } = {}
): LocalStorageProvider {
  const seed: Record<string, string> = {
    [GIVEAWAY_KEY]: JSON.stringify(GIVEAWAY),
    [STREAK_KEY]: JSON.stringify({
      currentDay: 4,
      totalEntriesEarned: 230,
      weeklyCurrent: 4,
      monthlyCurrent: 4,
      ...(overrides.lastClaimedDate ? { lastClaimedDate: overrides.lastClaimedDate } : {}),
    }),
  };
  if (overrides.emailSubmitted !== false) seed[EMAIL_KEY] = 'true';
  return fakeStorage(seed);
}

function makeController(options: {
  storage?: LocalStorageProvider;
  giveawayResponse?: Partial<GetActiveGiveawayResponse>;
  /** Hold getActiveGiveaway open so the cache frame is the only frame. */
  holdNetwork?: boolean;
  /** Hold the background claim open so the PREDICTED state stays pinned. */
  holdClaim?: boolean;
  deps?: Partial<V2ControllerDeps>;
} = {}): {
  controller: V2ExperienceController;
  api: { getActiveGiveaway: ReturnType<typeof vi.fn>; claimDailyEntries: ReturnType<typeof vi.fn> };
  releaseNetwork: () => void;
} {
  const response: GetActiveGiveawayResponse = {
    giveaway: GIVEAWAY,
    claimedToday: true,
    streakDay: 4,
    totalEntries: 230,
    emailConsentStatus: true,
    ...options.giveawayResponse,
  };
  let release: () => void = () => {};
  const gate = options.holdNetwork
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : null;
  const api = {
    getActiveGiveaway: vi.fn(async () => {
      if (gate) await gate;
      return response;
    }),
    claimDailyEntries: vi.fn(async () => {
      if (options.holdClaim) await new Promise<void>(() => {});
      return { entries: 130, streakDay: 5, totalEntries: 360 };
    }),
  };
  const deps: V2ControllerDeps = {
    api: api as unknown as AvafliAPI,
    storage: options.storage ?? warmStorage(),
    bundleId: BUNDLE,
    submitEmailAndAdopt: async () => ({ success: true }),
    hasRegisteredUuid: () => true,
    ...options.deps,
  };
  return { controller: new V2ExperienceController(deps), api, releaseNetwork: release };
}

describe('cache-first render', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('paints the dashboard from cache WITHOUT waiting on the network', () => {
    const { controller, api } = makeController({ holdNetwork: true });

    // Kick off the load, then hydrate exactly as the experience root does.
    void controller.load();
    const hydrated = controller.hydrateFromCache();

    expect(hydrated).toBe(true);
    expect(controller.state.kind).toBe('dashboard');
    expect(controller.hydratedFromCache).toBe(true);
    // Cached values, straight from local storage — no response has landed.
    expect(controller.giveaway?.id).toBe('g1');
    expect(controller.streakDay).toBe(4);
    expect(controller.totalEntries).toBe(230);
    // The request is still in flight — the dashboard did not wait for it.
    expect(api.getActiveGiveaway).toHaveBeenCalledTimes(1);
    expect(api.claimDailyEntries).not.toHaveBeenCalled();
  });

  it('the cache frame renders a real dashboard (prize card + rail + bar), calm', () => {
    const { controller } = makeController({ holdNetwork: true });
    controller.hydrateFromCache();

    const dash = renderDashboard(controller, null, () => {});

    expect(dash.querySelector('.wv2-prize-card')).not.toBeNull();
    expect(dash.querySelector('.wv2-rail')).not.toBeNull();
    expect(dash.querySelector('.wv2-comeback')).not.toBeNull();
    // Cached numbers are shown AS-IS — nothing pinned to N-1 for a
    // celebration that has not been staged.
    expect(dash.querySelector('.wv2-stat-streak')?.textContent).toBe('4 DAY STREAK');
    expect(dash.querySelector('.wv2-stat-total')?.textContent).toBe('230');
    // …and no celebration artifacts fire on the cache frame: today's tile
    // rests in `ready` (no drawn check, no burst GIF), and the come-back bar
    // rests on its pitch with no toast.
    expect(dash.querySelector('.wv2-tile.wv2-active')).toBeNull();
    expect(dash.querySelector('.wv2-tile.wv2-ready')).not.toBeNull();
    expect(dash.querySelector('.wv2-tile-burst')).toBeNull();
    expect(dash.querySelector('.wv2-comeback')?.classList.contains('wv2-toast-start')).toBe(false);
  });

  it('a cold cache keeps the SKELETON up — no dashboard, no spinner', () => {
    const { controller } = makeController({ storage: fakeStorage({ [EMAIL_KEY]: 'true' }) });

    expect(controller.hydrateFromCache()).toBe(false);
    expect(controller.state.kind).toBe('loading');

    const loading = renderLoading();
    // A block-out of the real layout, not a spinner + "Loading…".
    expect(loading.querySelector('.wv2-spinner')).toBeNull();
    expect(loading.textContent).toBe('');
    expect(loading.querySelector('.wv2-sk-pulse')).not.toBeNull();
    expect(loading.querySelector('.wv2-grabber')).not.toBeNull();
    expect(loading.querySelectorAll('.wv2-sk-circle').length).toBe(2);
    expect(loading.querySelector('.wv2-sk-logo')).not.toBeNull();
    expect(loading.querySelector('.wv2-sk-card')).not.toBeNull();
    expect(loading.querySelectorAll('.wv2-sk-tile').length).toBe(3);
    expect(loading.querySelector('.wv2-sk-bar')).not.toBeNull();
    expect(loading.querySelector('.wv2-sk-pill')).not.toBeNull();
  });

  it('a cached giveaway with NO persisted streak still takes the skeleton path', () => {
    const { controller } = makeController({
      storage: fakeStorage({ [EMAIL_KEY]: 'true', [GIVEAWAY_KEY]: JSON.stringify(GIVEAWAY) }),
    });

    expect(controller.hydrateFromCache()).toBe(false);
    expect(controller.state.kind).toBe('loading');
  });

  it('an UNCONSENTED user never sees a cached dashboard — it is email capture', async () => {
    const { controller } = makeController({
      storage: warmStorage({ emailSubmitted: false }),
      giveawayResponse: { emailConsentStatus: false },
    });

    // Everything else is cached and warm; the consent gate alone blocks it.
    expect(controller.hydrateFromCache()).toBe(false);
    expect(controller.state.kind).toBe('loading');

    await controller.load();
    expect(controller.state.kind).toBe('emailCapture');
  });

  it('a registered-but-unconsented user is blocked even with the uuid handshake', () => {
    const { controller } = makeController({
      storage: warmStorage({ emailSubmitted: false }),
      deps: { hasRegisteredUuid: () => true },
    });
    expect(controller.hydrateFromCache()).toBe(false);
  });

  it('never stomps fresher truth: hydration no-ops once the network resolved the phase', async () => {
    const { controller } = makeController({ giveawayResponse: { giveaway: null } });

    await controller.load();
    expect(controller.state.kind).toBe('empty');

    // The (slower) cache read must not resurrect a dashboard over it.
    expect(controller.hydrateFromCache()).toBe(false);
    expect(controller.state.kind).toBe('empty');
  });

  it('the fresh response reconciles the cache frame in place, celebrating exactly once', async () => {
    const { controller } = makeController({
      giveawayResponse: { claimedToday: false, streakDay: 4, totalEntries: 230 },
      holdClaim: true,
    });
    controller.hydrateFromCache();
    expect(controller.state.kind).toBe('dashboard');

    await controller.load();

    // Day 2+ path: the predicted grant is staged from SERVER truth (day 5 =
    // ladder 240), applied ONCE — the cache frame never bumped the streak.
    expect(controller.hydratedFromCache).toBe(false);
    expect(controller.streakDay).toBe(5);
    expect(controller.pendingRevealGrant).toEqual({ baseEntries: 240, bonusEntries: 0 });
    expect(controller.preClaimTotalEntries).toBe(230);
    expect(controller.claimRevealed).toBe(false);
  });

  it('a cache render survives a network failure instead of collapsing to empty', async () => {
    const { controller, api } = makeController({ giveawayResponse: { claimedToday: true } });
    api.getActiveGiveaway.mockRejectedValueOnce(new Error('offline'));
    controller.hydrateFromCache();

    await controller.load();

    expect(controller.state.kind).toBe('dashboard');
    expect(controller.giveaway?.id).toBe('g1');
  });
});

describe('come-back bar toast (late arrival)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a celebration staged AFTER the cache render still toasts — exactly once', () => {
    const { controller } = makeController({ holdNetwork: true });
    controller.hydrateFromCache();

    // The bar MOUNTS before anything is staged (cache-first render).
    const dash = renderDashboard(controller, null, () => {});
    const bar = dash.querySelector('.wv2-comeback') as HTMLElement;
    expect(bar.classList.contains('wv2-toast-start')).toBe(false);

    // …then the claim lands and the reveal fires against that same DOM.
    controller.pendingRevealGrant = { baseEntries: 240, bonusEntries: 0 };
    controller.hydratedFromCache = false;
    controller.onAutoReveal?.();

    expect(bar.classList.contains('wv2-toast-start')).toBe(true);
    // One-shot: a second attempt is refused, so it can never replay.
    expect(startComeBackToast(bar)).toBe(false);
  });

  it('a toast seeded at MOUNT is never restarted by the reveal', () => {
    const { controller } = makeController({ holdNetwork: true });
    controller.hydrateFromCache();
    controller.pendingRevealGrant = { baseEntries: 240, bonusEntries: 0 };
    controller.hydratedFromCache = false;

    const dash = renderDashboard(controller, null, () => {});
    const bar = dash.querySelector('.wv2-comeback') as HTMLElement;
    expect(bar.classList.contains('wv2-toast-start')).toBe(true);

    controller.onAutoReveal?.();
    // Already played at mount — the reveal's late-arrival path stands down.
    expect(startComeBackToast(bar)).toBe(false);
  });
});

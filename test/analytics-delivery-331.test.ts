// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AnalyticsAdapter } from '../src/types';
import { V2ControllerDeps, V2ExperienceController } from '../src/ui/v2/controller';
import { AvafliV2Experience } from '../src/ui/v2/root';
import { analyticsAdapter } from '../src/services/analytics';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

/**
 * 3.3.1 — two analytics delivery fixes.
 *
 * 1. `avafli_device_registered` reaches the publisher's adapter on the very
 *    `configure()` that installs it. Until 3.3.0 the adapter was attached
 *    AFTER registerDevice(), so the event went to the default console
 *    adapter and was never delivered. The rest of the order is unchanged:
 *    device_registered → identify → modal_presented → … → modal_dismissed.
 *
 * 2. `avafli_modal_dismissed` fires on EVERY dismissal path, exactly once,
 *    with a `reason`: `'user'` (X / GOT IT / CLOSE, backdrop, Escape),
 *    `'host'` (`Avafli.dismiss()`), `'deleted'` (the SDK closes the drawer
 *    after an in-drawer "Delete my data"). Until 3.3.0 only `Avafli.dismiss()`
 *    emitted it.
 */

type Entry = { kind: 'track'; event: string; props?: Record<string, unknown> } | { kind: 'identify'; userId: string };

function recorder(): { adapter: AnalyticsAdapter; timeline: Entry[] } {
  const timeline: Entry[] = [];
  return {
    timeline,
    adapter: {
      track: (event, props) => void timeline.push({ kind: 'track', event, props }),
      identify: (userId) => void timeline.push({ kind: 'identify', userId }),
    },
  };
}

const tracked = (timeline: Entry[], event: string) =>
  timeline.filter((e): e is Extract<Entry, { kind: 'track' }> => e.kind === 'track' && e.event === event);

// ─── 1. device_registered on the installing configure() ───

const BUNDLE = 'com.analytics.test';

function fakeJwt(): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800 })}.sig`;
}

const giveaway = {
  id: 'g-analytics',
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

function installFetch(): void {
  (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async (url: unknown) => {
    const respond = (result: unknown) =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ result }),
        text: async () => JSON.stringify({ result }),
      }) as unknown as Response;
    const u = String(url);
    const user = {
      claimedToday: false,
      streakDay: 1,
      totalEntries: 0,
      emailConsentStatus: false,
      optedOut: false,
    };
    if (u.includes('/registerDevice')) {
      return respond({
        token: fakeJwt(),
        refreshToken: 'rt',
        uuid: 'user-1',
        giveaway,
        isReturningUser: true,
        isNewUser: false,
        sdkConfig: { experience: { autoOpenEnabled: true, unregisteredImpressionCap: 3 } },
        ...user,
      });
    }
    if (u.includes('/getActiveGiveaway')) return respond({ giveaway, sdkConfig: null, ...user });
    return respond({ success: true });
  });
}

const host = (): Element | null => document.querySelector('[data-winr="v2"]');

describe('3.3.1 avafli_device_registered reaches the adapter installed by the same configure()', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = 'avafli_did=; Max-Age=0; Path=/';
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
    installFetch();
  });

  it('delivers it, first, with its properties — then identify, in the old order', async () => {
    const { Avafli } = await import('../src/index');
    const { adapter, timeline } = recorder();
    await Avafli.configure({
      apiKey: 'k',
      bundleId: BUNDLE,
      user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace' },
      autoOpen: 'never',
      options: { analyticsAdapter: adapter },
    });

    expect(timeline[0]).toEqual({
      kind: 'track',
      event: 'avafli_device_registered',
      props: { isReturningUser: true, giveawayId: 'g-analytics' },
    });
    expect(timeline[1]).toEqual({ kind: 'identify', userId: 'u-1' });
    expect(tracked(timeline, 'avafli_device_registered')).toHaveLength(1);
  });

  it('keeps every other event after it: presented, then dismissed with reason "host" via Avafli.dismiss(), once', async () => {
    const { Avafli } = await import('../src/index');
    const { adapter, timeline } = recorder();
    await Avafli.configure({
      apiKey: 'k',
      bundleId: BUNDLE,
      user: { id: 'u-1' },
      autoOpen: 'never',
      options: { analyticsAdapter: adapter },
    });

    const shown = Avafli.present();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    Avafli.dismiss();
    Avafli.dismiss(); // a second host call on a closing drawer is a no-op
    await expect(shown).resolves.toBe(true);

    const events = timeline.filter((e) => e.kind === 'track').map((e) => (e as { event: string }).event);
    expect(events.indexOf('avafli_device_registered')).toBe(0);
    expect(events.indexOf('avafli_modal_presented')).toBeGreaterThan(0);
    expect(events.indexOf('avafli_modal_dismissed')).toBeGreaterThan(events.indexOf('avafli_modal_presented'));
    const dismissed = tracked(timeline, 'avafli_modal_dismissed');
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]!.props).toEqual({ reason: 'host' });
  });
});

// ─── 2. avafli_modal_dismissed on every path ───

function fakeStorage(): LocalStorageProvider {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  } as unknown as LocalStorageProvider;
}

/**
 * The real drawer (controller + shadow-DOM root) with a backend that cannot
 * be reached — load() settles on the empty screen, whose CLOSE pill is one of
 * the visitor's dismissal paths.
 */
function mountDrawer(): {
  controller: V2ExperienceController;
  experience: AvafliV2Experience;
  shadow: () => ShadowRoot;
} {
  const deps: V2ControllerDeps = {
    api: {
      getActiveGiveaway: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as AvafliAPI,
    storage: fakeStorage(),
    bundleId: 'com.dismiss.test',
    submitEmailAndAdopt: vi.fn(),
    hasRegisteredUuid: () => true,
    optOut: vi.fn(async () => {}),
  };
  const controller = new V2ExperienceController(deps);
  const experience = new AvafliV2Experience(controller, {});
  void experience.present();
  const shadow = () => host()!.shadowRoot!;
  return { controller, experience, shadow };
}

describe('3.3.1 avafli_modal_dismissed fires on every dismissal path, once, with a reason', () => {
  let timeline: Entry[];

  beforeEach(() => {
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
    const rec = recorder();
    timeline = rec.timeline;
    analyticsAdapter.setAdapter(rec.adapter);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
  });

  const dismissed = () => tracked(timeline, 'avafli_modal_dismissed');

  it('X / GOT IT (controller.requestDismiss) → "user"', () => {
    const { controller } = mountDrawer();
    expect(host()).not.toBeNull();
    controller.requestDismiss();
    expect(dismissed()).toHaveLength(1);
    expect(dismissed()[0]!.props).toEqual({ reason: 'user' });
  });

  it('the empty screen\'s CLOSE pill → "user"', async () => {
    const { shadow } = mountDrawer();
    const close = await vi.waitFor(() => {
      const pill = Array.from(shadow().querySelectorAll('button')).find((b) => b.textContent === 'CLOSE');
      expect(pill).toBeTruthy();
      return pill!;
    });
    close.click();
    expect(dismissed()).toHaveLength(1);
    expect(dismissed()[0]!.props).toEqual({ reason: 'user' });
  });

  it('backdrop tap → "user"', () => {
    const { shadow } = mountDrawer();
    (shadow().querySelector('.wv2-backdrop') as HTMLElement).click();
    expect(dismissed()).toHaveLength(1);
    expect(dismissed()[0]!.props).toEqual({ reason: 'user' });
  });

  it('Escape → "user"', () => {
    mountDrawer();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissed()).toHaveLength(1);
    expect(dismissed()[0]!.props).toEqual({ reason: 'user' });
  });

  it('the host page (experience.dismiss("host")) → "host"', () => {
    const { experience } = mountDrawer();
    experience.dismiss('host');
    expect(dismissed()).toHaveLength(1);
    expect(dismissed()[0]!.props).toEqual({ reason: 'host' });
  });

  it('the auto-close after an in-drawer "Delete my data" → "deleted"', async () => {
    vi.useFakeTimers();
    const { controller } = mountDrawer();
    controller.showOptOutConfirmation();
    await controller.confirmOptOut();
    expect(controller.optOutPhase).toBe('done');
    expect(dismissed()).toHaveLength(0); // the success copy holds first
    vi.advanceTimersByTime(V2ExperienceController.OPT_OUT_SUCCESS_HOLD_MS);
    expect(dismissed()).toHaveLength(1);
    expect(dismissed()[0]!.props).toEqual({ reason: 'deleted' });
  });

  it('exactly once: a second dismissal of a closing drawer (any path) emits nothing more', () => {
    const { controller, experience, shadow } = mountDrawer();
    const backdrop = shadow().querySelector('.wv2-backdrop') as HTMLElement;
    controller.requestDismiss();
    backdrop.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    experience.dismiss('host');
    expect(dismissed()).toHaveLength(1);
    expect(dismissed()[0]!.props).toEqual({ reason: 'user' });
  });

  it('Escape with the legal overlay open closes the overlay only — no dismissal event', () => {
    const { controller } = mountDrawer();
    controller.showLegalOverlay('privacy');
    expect(controller.legalOverlay).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(controller.legalOverlay).toBeNull();
    expect(host()).not.toBeNull();
    expect(dismissed()).toHaveLength(0);
  });
});

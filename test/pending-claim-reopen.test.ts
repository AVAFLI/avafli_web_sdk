// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 3.2.0 — a winner can always reopen a pending prize claim.
 *
 * The auto-open used to gate on the once-per-day mark alone, so a winner who
 * closed the drawer could not get back to the claim until the next calendar
 * day. While the latest registerDevice / getActiveGiveaway response reports
 * `prizeClaim.status === "pending"` the check now:
 *  - BYPASSES the once-per-day mark, the unregistered impression cap (and
 *    counts no impression) and the `returningUsersOnly` mode;
 *  - still RESPECTS holdAutoOpen(), the opt-out, the server kill switch and
 *    mode `never` (that publisher opens the winner flow with present());
 *  - opens on every page load, and on tab foreground/focus only when 30
 *    minutes have passed since it was last shown — tracked under its own key.
 */

const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const MINUTE = 60 * 1000;

const VALID_USER = { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace' };

const markKey = (bundle: string): string => `winr_last_auto_present_${bundle}`;
const claimMarkKey = (bundle: string): string => `winr_last_claim_auto_present_${bundle}`;
const impressionsKey = (bundle: string): string => `winr_unregistered_impressions_${bundle}`;

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function fakeJwt(): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800 })}.sig`;
}

const giveaway = {
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

const claim = (status: 'pending' | 'submitted'): Record<string, unknown> => ({
  status,
  giveawayId: 'g1',
  prizeDescription: 'Cash Prize',
  prizeValue: 1000,
  maskedEmail: 'a********e@avafli.example.com',
  ...(status === 'submitted'
    ? { claimNumber: 'WNR-2026-0042', submittedAt: '2026-09-29T11:00:00Z' }
    : {}),
});

/** Per-user fields both endpoints answer with; swap mid-test to move the server on. */
let server: Record<string, unknown>;
let sdkConfig: Record<string, unknown>;
let calls: string[];

function installFetch(): void {
  calls = [];
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
    calls.push(u);
    const user = {
      giveaway,
      claimedToday: true,
      streakDay: 3,
      totalEntries: 100,
      emailConsentStatus: true,
      optedOut: false,
      ...server,
    };
    if (u.includes('/registerDevice')) {
      return respond({
        token: fakeJwt(),
        refreshToken: 'rt',
        uuid: 'user-1',
        isReturningUser: false,
        isNewUser: false,
        sdkConfig,
        ...user,
      });
    }
    if (u.includes('/getActiveGiveaway')) return respond({ sdkConfig: null, ...user });
    return respond({ success: true });
  });
}

async function sdk() {
  const { Avafli } = await import('../src/index');
  return Avafli;
}

async function configureSDK(bundle: string, extra: Record<string, unknown> = {}): Promise<void> {
  const Avafli = await sdk();
  await Avafli.configure({ apiKey: 'k', bundleId: bundle, user: { ...VALID_USER }, ...extra });
}

const host = (): HTMLElement | null => document.querySelector('[data-winr="v2"]');
const shadow = (): ShadowRoot | null => host()?.shadowRoot ?? null;
const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));
const foreground = async (): Promise<void> => {
  window.dispatchEvent(new Event('focus'));
  await settle();
};

const winnerSplashShown = async (): Promise<void> => {
  await vi.waitFor(() => expect(shadow()?.querySelector('.wv2-claim-congrats')).not.toBeNull());
};

/**
 * When the experience was last shown for a pending claim. (vi.waitFor nudges
 * the faked clock while it polls, so tests measure FROM this stamp rather
 * than assuming it is exactly NOW.)
 */
function shownAt(bundle: string): number {
  const raw = localStorage.getItem(claimMarkKey(bundle));
  expect(raw, 'the pending-claim stamp').not.toBeNull();
  const at = Number(raw);
  expect(at).toBeGreaterThanOrEqual(NOW);
  return at;
}

/** Closes the drawer the way a person does, and waits for it to be gone. */
async function closeDrawer(): Promise<void> {
  await vi.waitFor(() =>
    expect(shadow()?.querySelector('button[aria-label="Close"]')).not.toBeNull()
  );
  (shadow()!.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(host()).toBeNull());
  await settle();
}

describe('3.2.0 winners can always reopen a pending claim', () => {
  // Focus/visibility listeners outlive vi.resetModules() — drop the ones each
  // test attached, so an earlier test's SDK never answers a later test's focus.
  let attached: Array<[EventTarget, string, EventListenerOrEventListenerObject]>;

  beforeEach(() => {
    vi.resetModules();
    // Only the clock is faked: the SDK's promises and timers run for real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    sessionStorage.clear();
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
    server = { prizeClaim: claim('pending') };
    sdkConfig = { experience: { autoOpenEnabled: true, unregisteredImpressionCap: 3 } };
    installFetch();

    attached = [];
    for (const target of [window, document] as EventTarget[]) {
      const add = target.addEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        attached.push([target, type, listener]);
        add(type, listener, options);
      }) as typeof target.addEventListener);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    attached.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
    vi.useRealTimers();
  });

  it('pending claim + the daily mark already set today → opens on configure, on the winner splash', async () => {
    const bundle = 'com.claim.reopen';
    localStorage.setItem(markKey(bundle), todayString());

    await configureSDK(bundle);
    await winnerSplashShown();

    // The throttle is stamped on close, under its OWN key.
    expect(localStorage.getItem(claimMarkKey(bundle))).toBeNull();
    await closeDrawer();
    expect(shownAt(bundle)).toBeLessThan(NOW + MINUTE);
    expect(localStorage.getItem(markKey(bundle))).toBe(todayString());
  });

  it('every page load opens it — even seconds after the last time', async () => {
    const bundle = 'com.claim.reload';
    localStorage.setItem(markKey(bundle), todayString());
    localStorage.setItem(claimMarkKey(bundle), String(NOW - 20 * 1000)); // the previous load

    await configureSDK(bundle);
    await winnerSplashShown();
  });

  it('focus inside 30 minutes → does not reopen; focus after 30 minutes → reopens', async () => {
    const bundle = 'com.claim.throttle';
    localStorage.setItem(markKey(bundle), todayString());
    await configureSDK(bundle);
    await winnerSplashShown();
    await closeDrawer();
    const first = shownAt(bundle);

    vi.setSystemTime(first + 5 * MINUTE);
    await foreground();
    expect(host()).toBeNull();

    vi.setSystemTime(first + 30 * MINUTE - 1000);
    await foreground();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(host()).toBeNull();
    expect(shownAt(bundle)).toBe(first);

    vi.setSystemTime(first + 30 * MINUTE);
    await foreground();
    await winnerSplashShown();

    // Shown again → the interval starts again from this close.
    await closeDrawer();
    const second = shownAt(bundle);
    expect(second).toBeGreaterThanOrEqual(first + 30 * MINUTE);
    vi.setSystemTime(second + 15 * MINUTE);
    await foreground();
    expect(host()).toBeNull();
  });

  it("mode 'never' → no auto-open, but present() lands on the winner splash", async () => {
    const bundle = 'com.claim.never';
    await configureSDK(bundle, { autoOpen: 'never' });
    await settle();
    expect(host()).toBeNull();
    await foreground();
    expect(host()).toBeNull();
    expect(localStorage.getItem(claimMarkKey(bundle))).toBeNull();

    const Avafli = await sdk();
    const presented = Avafli.present();
    await winnerSplashShown();
    await closeDrawer();
    await expect(presented).resolves.toBe(true);
  });

  it("the SERVER's mode 'never' is respected too", async () => {
    const bundle = 'com.claim.never.server';
    sdkConfig = { experience: { autoOpenEnabled: true, autoOpenMode: 'never' } };
    await configureSDK(bundle);
    await settle();
    await foreground();
    expect(host()).toBeNull();
  });

  it('present() opens the winner flow even when the giveaway itself has ended', async () => {
    const bundle = 'com.claim.nogiveaway';
    server = { prizeClaim: claim('pending'), giveaway: null };
    await configureSDK(bundle, { autoOpen: 'never' });
    const Avafli = await sdk();
    const presented = Avafli.present();
    await winnerSplashShown();
    await closeDrawer();
    await expect(presented).resolves.toBe(true);
  });

  it('a pending claim that outlived its giveaway still auto-opens', async () => {
    const bundle = 'com.claim.outlived';
    server = { prizeClaim: claim('pending'), giveaway: null };
    localStorage.setItem(markKey(bundle), todayString());
    await configureSDK(bundle);
    await winnerSplashShown();
  });

  it('held → deferred; opens on release (still the page-load opening, whatever the throttle says)', async () => {
    const bundle = 'com.claim.hold';
    localStorage.setItem(markKey(bundle), todayString());
    localStorage.setItem(claimMarkKey(bundle), String(NOW - 2 * MINUTE));
    const Avafli = await sdk();
    Avafli.holdAutoOpen();

    await configureSDK(bundle);
    await settle();
    await foreground();
    expect(host()).toBeNull();
    // Nothing was burned while held.
    expect(localStorage.getItem(claimMarkKey(bundle))).toBe(String(NOW - 2 * MINUTE));
    expect(localStorage.getItem(markKey(bundle))).toBe(todayString());

    Avafli.releaseAutoOpen();
    await winnerSplashShown();
  });

  it("'returningUsersOnly' (client or server) does not keep a winner from the claim", async () => {
    const client = 'com.claim.returning.client';
    server = { prizeClaim: claim('pending'), isNewUser: true };
    await configureSDK(client, { autoOpen: 'returningUsersOnly' });
    await winnerSplashShown();
    await closeDrawer();

    vi.resetModules();
    const viaServer = 'com.claim.returning.server';
    sdkConfig = { experience: { autoOpenEnabled: true, autoOpenMode: 'returningUsersOnly' } };
    await configureSDK(viaServer);
    await winnerSplashShown();
  });

  it('the impression cap is bypassed and the counter is left untouched', async () => {
    const bundle = 'com.claim.impressions';
    server = { prizeClaim: claim('pending'), emailConsentStatus: false };
    localStorage.setItem(impressionsKey(bundle), '3'); // at the cap
    localStorage.setItem(markKey(bundle), todayString());

    await configureSDK(bundle);
    await winnerSplashShown();
    await closeDrawer();
    expect(localStorage.getItem(impressionsKey(bundle))).toBe('3');

    // Below the cap: still not counted.
    vi.resetModules();
    const fresh = 'com.claim.impressions.fresh';
    await configureSDK(fresh);
    await winnerSplashShown();
    await closeDrawer();
    expect(localStorage.getItem(impressionsKey(fresh))).toBeNull();
  });

  it('the server kill switch and the opt-out still win', async () => {
    const killed = 'com.claim.killed';
    sdkConfig = { experience: { autoOpenEnabled: false } };
    await configureSDK(killed);
    await settle();
    await foreground();
    expect(host()).toBeNull();

    vi.resetModules();
    const optedOut = 'com.claim.optedout';
    sdkConfig = { experience: { autoOpenEnabled: true } };
    server = {
      prizeClaim: claim('pending'),
      optedOut: true,
      optedOutUntil: new Date(NOW + 60 * MINUTE).toISOString(),
    };
    await configureSDK(optedOut);
    await settle();
    await foreground();
    expect(host()).toBeNull();
    const Avafli = await sdk();
    await expect(Avafli.present()).resolves.toBe(false);
  });

  it('status "submitted" → the normal once-per-day rules again', async () => {
    const marked = 'com.claim.submitted.marked';
    server = { prizeClaim: claim('submitted') };
    localStorage.setItem(markKey(marked), todayString());
    await configureSDK(marked);
    await settle();
    await foreground();
    expect(host()).toBeNull();
    expect(localStorage.getItem(claimMarkKey(marked))).toBeNull();

    // No mark yet today: the ordinary daily auto-open, on the dashboard.
    vi.resetModules();
    const unmarked = 'com.claim.submitted.unmarked';
    await configureSDK(unmarked);
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await settle(200);
    expect(shadow()?.querySelector('.wv2-claim-congrats')).toBeNull();
    await closeDrawer();
    expect(localStorage.getItem(markKey(unmarked))).toBe(todayString());
    expect(localStorage.getItem(claimMarkKey(unmarked))).toBeNull();
    await foreground();
    expect(host()).toBeNull();
  });

  it('a later response without a pending claim ends the bypass', async () => {
    const bundle = 'com.claim.resolved';
    localStorage.setItem(markKey(bundle), todayString());
    await configureSDK(bundle);
    await winnerSplashShown();
    await closeDrawer();

    // 30 minutes on it reopens — and this time the server says the claim is
    // in. The drawer's refresh clears the flag; nothing reopens after that.
    server = { prizeClaim: claim('submitted') };
    vi.setSystemTime(NOW + 31 * MINUTE);
    await foreground();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await vi.waitFor(() =>
      expect(calls.filter((u) => u.includes('/getActiveGiveaway')).length).toBeGreaterThan(1)
    );
    await settle(200);
    await closeDrawer();

    vi.setSystemTime(NOW + 120 * MINUTE);
    await foreground();
    expect(host()).toBeNull();
  });

  it('a claim found by the daily auto-open stamps the throttle too', async () => {
    const bundle = 'com.claim.discovered';
    // Registration did not report it; the drawer's own refresh does.
    let registered = false;
    const pending = claim('pending');
    server = {};
    const base = globalThis.fetch;
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: unknown, init?: RequestInit) => {
        if (String(url).includes('/registerDevice')) registered = true;
        else if (registered) server = { prizeClaim: pending };
        return base(url as string, init);
      }
    );

    await configureSDK(bundle);
    await winnerSplashShown();
    await closeDrawer();
    const at = shownAt(bundle);

    vi.setSystemTime(at + 10 * MINUTE);
    await foreground();
    expect(host()).toBeNull();
    vi.setSystemTime(at + 31 * MINUTE);
    await foreground();
    await winnerSplashShown();
  });
});

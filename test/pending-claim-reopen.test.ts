// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { V2ControllerDeps, V2ExperienceController, V2State } from '../src/ui/v2/controller';
import { renderClaimConfirmation } from '../src/ui/v2/screens';
import { AvafliError, AvafliErrorCode, PrizeClaimBlock } from '../src/types';
import { AvafliAPI } from '../src/network/api';
import { LocalStorageProvider } from '../src/storage/local-storage';

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
/** False = the server keeps answering "pending" after a submit (a stale read). */
let submitMovesServerOn: boolean;

function installFetch(): void {
  calls = [];
  submitMovesServerOn = true;
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
    if (u.includes('/submitPrizeClaim')) {
      // The backend records it: every later response reports "submitted".
      if (submitMovesServerOn) server = { ...server, prizeClaim: claim('submitted') };
      return respond({ claimNumber: 'WNR-2026-0042', submittedAt: '2026-09-29T12:00:00Z' });
    }
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

/**
 * Every screen the drawer ever painted that is NOT the winner flow — the
 * dashboard and the "Nothing to see here yet" empty state. Watched from the
 * moment the shadow root exists, so not even a one-frame flash gets past.
 */
let strayFrames: string[];

function watchFrames(): void {
  strayFrames = [];
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit
  ) {
    const root = attach.call(this, init);
    new MutationObserver(() => {
      if (root.querySelector('.wv2-dash-stack')) strayFrames.push('dashboard');
      if (root.querySelector('.wv2-empty-title')) strayFrames.push('empty');
      if (root.querySelector('input[type="email"]')) strayFrames.push('emailCapture');
    }).observe(root, { childList: true, subtree: true });
    return root;
  });
}

const pill = (label: string): HTMLButtonElement | null =>
  (Array.from(shadow()?.querySelectorAll('button.wv2-pill') ?? []).find(
    (b) => b.textContent === label
  ) as HTMLButtonElement | undefined) ?? null;

async function tapPill(label: string): Promise<void> {
  await vi.waitFor(() => {
    const button = pill(label);
    expect(button, label).not.toBeNull();
    expect(button!.disabled, `${label} enabled`).toBe(false);
  });
  pill(label)!.click();
  await settle(400); // the claim steps slide for 320 ms
}

function fill(selector: string, index: number, value: string): void {
  const pages = shadow()!.querySelectorAll('.wv2-claim-page');
  const page = pages[pages.length - 1]!;
  const control = page.querySelectorAll(selector)[index] as HTMLInputElement | HTMLSelectElement;
  control.value = value;
  control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input'));
}

/** Walks the whole claim form the way a winner does, up to the confirmation. */
async function submitClaimThroughTheDrawer(): Promise<void> {
  await tapPill('CONTINUE'); // splash → step 1 (name prefilled from the host user)
  await tapPill('CONTINUE'); // → step 2
  fill('input.wv2-sf-input', 0, '12 Analytical Way');
  fill('input.wv2-sf-input', 2, 'Brooklyn');
  fill('select.wv2-sf-select', 0, 'New York');
  fill('input.wv2-sf-input', 3, '11201');
  await tapPill('CONTINUE'); // → step 3 (photo is optional)
  await tapPill('CONTINUE'); // → review
  await tapPill('SUBMIT PRIZE CLAIM'); // → share step
  await tapPill('CONTINUE'); // → confirmation
  await vi.waitFor(() => expect(pill('RETURN TO APP')).not.toBeNull());
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

    watchFrames();
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
    expect(strayFrames).toContain('dashboard'); // (the frame watcher does see one)
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
  // ── Second addendum: the flag follows the drawer; no active giveaway ──

  it('the winner splash is the first frame — no dashboard is painted behind it', async () => {
    const bundle = 'com.claim.firstframe';
    localStorage.setItem(markKey(bundle), todayString());
    await configureSDK(bundle);
    await vi.waitFor(() => expect(host()).not.toBeNull());
    // Already there on first sight, before the drawer's own refresh answered.
    expect(shadow()!.querySelector('.wv2-claim-congrats')).not.toBeNull();
    await settle(200);
    await closeDrawer();
    expect(strayFrames).toEqual([]);
  });

  it('a submitted claim is not reopened 30 minutes later by the boot-time flag', async () => {
    const bundle = 'com.claim.submitted.inside';
    // The worst case: nothing after the submit tells the SDK — no refresh
    // runs, and the server would still answer "pending" if one did.
    submitMovesServerOn = false;
    localStorage.setItem(markKey(bundle), todayString());
    await configureSDK(bundle);
    await winnerSplashShown();
    const refreshes = (): number => calls.filter((u) => u.includes('/getActiveGiveaway')).length;
    await vi.waitFor(() => expect(refreshes()).toBe(1));

    await submitClaimThroughTheDrawer();
    expect(calls.filter((u) => u.includes('/submitPrizeClaim'))).toHaveLength(1);
    pill('RETURN TO APP')!.click();
    await vi.waitFor(() => expect(host()).toBeNull());
    await settle();
    expect(refreshes()).toBe(1);

    // No stamp for a claim that is no longer pending, and no reopen.
    expect(localStorage.getItem(claimMarkKey(bundle))).toBeNull();
    vi.setSystemTime(NOW + 45 * MINUTE);
    await foreground();
    await foreground();
    expect(host()).toBeNull();
  });

  it('a device clock set back behind the stamp does not lock the winner out', async () => {
    const bundle = 'com.claim.clock';
    localStorage.setItem(markKey(bundle), todayString());
    await configureSDK(bundle);
    await winnerSplashShown();
    await closeDrawer();
    const at = shownAt(bundle);

    vi.setSystemTime(at - 3 * 60 * MINUTE); // the clock went back three hours
    await foreground();
    await winnerSplashShown();
  });

  describe('no active giveaway (it ended before the draw)', () => {
    beforeEach(() => {
      server = { prizeClaim: claim('pending'), giveaway: null };
    });

    it('register returns giveaway null + a pending claim → opens on configure, on the winner splash', async () => {
      const bundle = 'com.claim.ended';
      localStorage.setItem(markKey(bundle), todayString());
      await configureSDK(bundle);
      await winnerSplashShown();
      expect(shadow()!.querySelector('.wv2-claim-strip')?.textContent).toContain('1,000');
      expect(localStorage.getItem('winr_cached_giveaway')).toBeNull();
    });

    it('present() in that state → opens', async () => {
      const bundle = 'com.claim.ended.present';
      await configureSDK(bundle, { autoOpen: 'never' });
      await settle();
      expect(host()).toBeNull();
      const Avafli = await sdk();
      const presented = Avafli.present();
      await winnerSplashShown();
      await closeDrawer();
      await expect(presented).resolves.toBe(true);
    });

    it('close → dismissed, with no dashboard or empty frame at any point', async () => {
      const bundle = 'com.claim.ended.close';
      await configureSDK(bundle);
      await winnerSplashShown();
      await vi.waitFor(() =>
        expect(calls.some((u) => u.includes('/getActiveGiveaway'))).toBe(true)
      );
      await settle(200);
      await closeDrawer();
      expect(host()).toBeNull();
      expect(strayFrames).toEqual([]);

      // Still pending → still reachable: the next foreground after 30 minutes.
      vi.setSystemTime(shownAt(bundle) + 30 * MINUTE);
      await foreground();
      await winnerSplashShown();
      await closeDrawer();
      expect(strayFrames).toEqual([]);
    });

    it('submit success → confirmation, then RETURN TO APP dismisses; nothing behind it, no reopen', async () => {
      const bundle = 'com.claim.ended.submit';
      await configureSDK(bundle);
      await winnerSplashShown();

      await submitClaimThroughTheDrawer();
      expect(shadow()!.textContent).toContain('WNR-2026-0042');
      pill('RETURN TO APP')!.click();
      await vi.waitFor(() => expect(host()).toBeNull());
      await settle();
      expect(strayFrames).toEqual([]);

      vi.setSystemTime(NOW + 45 * MINUTE);
      await foreground();
      expect(host()).toBeNull();
    });

    it('the claim turns out to be gone → the drawer closes instead of showing an empty state', async () => {
      const bundle = 'com.claim.ended.gone';
      // Registration says "pending"; by the time the drawer refreshes, the
      // claim is no longer there (expired) and there is no giveaway either.
      const base = globalThis.fetch;
      (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
        async (url: unknown, init?: RequestInit) => {
          const response = await base(url as string, init);
          if (String(url).includes('/registerDevice')) server = { giveaway: null };
          return response;
        }
      );
      let opened = false;
      const seen = new MutationObserver(() => {
        if (host()) opened = true;
      });
      seen.observe(document.body, { childList: true });

      await configureSDK(bundle);
      await vi.waitFor(() => expect(opened).toBe(true));
      await vi.waitFor(() => expect(host()).toBeNull());
      seen.disconnect();
      expect(strayFrames).toEqual([]);

      vi.setSystemTime(NOW + 45 * MINUTE);
      await foreground();
      expect(host()).toBeNull();
    });

    it('giveaway null + NO claim → still declines (auto-open and present())', async () => {
      const bundle = 'com.claim.ended.none';
      server = { giveaway: null };
      await configureSDK(bundle);
      await settle();
      await foreground();
      expect(host()).toBeNull();
      const Avafli = await sdk();
      await expect(Avafli.present()).resolves.toBe(false);
      expect(host()).toBeNull();
    });

    it('claim "submitted" + no giveaway → no auto-open', async () => {
      const bundle = 'com.claim.ended.submitted';
      server = { giveaway: null, prizeClaim: claim('submitted') };
      await configureSDK(bundle);
      await settle();
      await foreground();
      expect(host()).toBeNull();
      const Avafli = await sdk();
      await expect(Avafli.present()).resolves.toBe(false);
    });

    it('offline when the drawer opens → the winner flow from the block in hand, never a blank screen', async () => {
      const bundle = 'com.claim.ended.offline';
      await configureSDK(bundle, { autoOpen: 'never' });
      // Registered fine; then the network went away.
      const online = globalThis.fetch;
      (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });

      const Avafli = await sdk();
      void Avafli.present();
      await winnerSplashShown();
      await settle(200);
      expect(shadow()!.querySelector('.wv2-claim-congrats')).not.toBeNull();
      expect(strayFrames).toEqual([]);

      (globalThis as unknown as Record<string, unknown>).fetch = online;
      await closeDrawer();
    });
  });
});

describe('3.2.0 leaving the winner flow with no active giveaway (controller)', () => {
  const PENDING: PrizeClaimBlock = {
    status: 'pending',
    giveawayId: 'g1',
    prizeDescription: 'Cash Prize',
    prizeValue: 1000,
    maskedEmail: 'a********e@avafli.example.com',
  };

  const FORM = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '',
    street: '12 Analytical Way',
    apt: '',
    city: 'Brooklyn',
    state: 'New York',
    zip: '11201',
    authorizesLikeness: false,
  };

  function rejection(httpStatus: number, message: string): AvafliError {
    const error = new AvafliError(AvafliErrorCode.InvalidState, message);
    error.httpStatus = httpStatus;
    return error;
  }

  function make(options: {
    giveaway: typeof giveaway | null;
    claim?: PrizeClaimBlock;
    submit?: () => Promise<unknown>;
    confirm?: () => Promise<unknown>;
  }) {
    const api = {
      getActiveGiveaway: vi.fn(async () => ({
        giveaway: options.giveaway,
        claimedToday: false,
        streakDay: 3,
        totalEntries: 100,
        emailConsentStatus: true,
        prizeClaim: options.claim ?? PENDING,
      })),
      claimDailyEntries: vi.fn(async () => ({ entries: 60, streakDay: 4, totalEntries: 160 })),
      submitPrizeClaim: vi.fn(
        options.submit ??
          (async () => ({ claimNumber: 'WNR-2026-0042', submittedAt: '2026-09-29T12:00:00Z' }))
      ),
      sendClaimVerificationCode: vi.fn(async () => ({
        sent: true,
        verification: { required: true },
      })),
      confirmClaimVerificationCode: vi.fn(
        options.confirm ?? (async () => ({ verified: true, verification: { required: false } }))
      ),
    };
    const store = new Map<string, string>([['winr_email_submitted_com.test', 'true']]);
    const onPrizeClaimUnavailable = vi.fn();
    const onPrizeClaimSubmitted = vi.fn();
    const deps: V2ControllerDeps = {
      api: api as unknown as AvafliAPI,
      storage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      } as unknown as LocalStorageProvider,
      bundleId: 'com.test',
      submitEmailAndAdopt: async () => ({ success: true }),
      hasRegisteredUuid: () => true,
      cachedPrizeClaim: options.claim ?? PENDING,
      onPrizeClaimUnavailable,
      onPrizeClaimSubmitted,
    };
    const controller = new V2ExperienceController(deps);
    const states: Array<V2State['kind']> = [];
    controller.onChange = (state) => states.push(state.kind);
    const dismissed = vi.fn();
    controller.onDismissRequest = dismissed;
    return { controller, api, states, dismissed, onPrizeClaimUnavailable, onPrizeClaimSubmitted };
  }

  it('the whole flow works without a giveaway; the confirmation dismisses the experience', async () => {
    const h = make({ giveaway: null, claim: { ...PENDING, verification: { required: true } } });
    expect(h.controller.hydrateFromCache()).toBe(true);
    expect(h.controller.state.kind).toBe('winnerClaim');
    await h.controller.load();
    expect(h.controller.giveaway).toBeNull();
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'splash' });
    // No giveaway → no daily entry to claim behind the winner flow.
    expect(h.api.claimDailyEntries).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      h.controller.winnerClaimContinue();
      expect(h.controller.winnerClaimStep).toEqual({ kind: 'code' });
      await h.controller.confirmClaimCode('123456');
      vi.advanceTimersByTime(V2ExperienceController.CLAIM_CODE_VERIFIED_HOLD_MS);
    } finally {
      vi.useRealTimers();
    }
    expect(h.controller.winnerClaimStep).toEqual({ kind: 'form' });

    await h.controller.submitPrizeClaim(FORM);
    expect(h.controller.winnerClaimStep.kind).toBe('share');
    expect(h.onPrizeClaimSubmitted).toHaveBeenCalledOnce();
    h.controller.winnerShareContinue();
    expect(h.controller.winnerClaimStep.kind).toBe('confirmation');

    const screen = renderClaimConfirmation(
      h.controller,
      'WNR-2026-0042',
      '2026-09-29T12:00:00Z'
    );
    const done = Array.from(screen.querySelectorAll('button')).find(
      (b) => b.textContent === 'RETURN TO APP'
    )!;
    done.click();
    expect(h.dismissed).toHaveBeenCalledOnce();
    expect(h.states.every((kind) => kind === 'winnerClaim')).toBe(true);
  });

  it.each([
    ['Not the winner', 403],
    ['Already submitted', 409],
  ])('submit rejected as "%s" → dismissed, and the SDK is told the claim is not pending', async (message, status) => {
    const h = make({
      giveaway: null,
      submit: async () => {
        throw rejection(status, message);
      },
    });
    await h.controller.load();
    h.controller.winnerClaimContinue();
    await h.controller.submitPrizeClaim(FORM);

    expect(h.dismissed).toHaveBeenCalledOnce();
    expect(h.onPrizeClaimUnavailable).toHaveBeenCalledWith('g1');
    expect(h.api.getActiveGiveaway).toHaveBeenCalledOnce(); // no reload behind it
    expect(h.states).not.toContain('empty');
    expect(h.states).not.toContain('dashboard');
    expect(h.states).not.toContain('loading');
  });

  it('claim expired on the code step → dismissed, never an empty state', async () => {
    const h = make({
      giveaway: null,
      claim: { ...PENDING, verification: { required: true } },
      confirm: async () => {
        throw rejection(400, 'The claim window for this prize has expired');
      },
    });
    await h.controller.load();
    h.controller.winnerClaimContinue();
    await h.controller.confirmClaimCode('123456');

    expect(h.dismissed).toHaveBeenCalledOnce();
    expect(h.onPrizeClaimUnavailable).toHaveBeenCalledWith('g1');
    expect(h.states).not.toContain('empty');
    expect(h.states).not.toContain('dashboard');
    expect(h.states).not.toContain('loading');
  });

  it('WITH a giveaway the same rejections behave as before: back onto the dashboard', async () => {
    const h = make({
      giveaway,
      submit: async () => {
        throw rejection(403, 'Not the winner');
      },
    });
    await h.controller.load();
    h.controller.winnerClaimContinue();
    await h.controller.submitPrizeClaim(FORM);

    expect(h.dismissed).not.toHaveBeenCalled();
    expect(h.onPrizeClaimUnavailable).toHaveBeenCalledWith('g1');
    expect(h.controller.state.kind).toBe('dashboard');
  });
});

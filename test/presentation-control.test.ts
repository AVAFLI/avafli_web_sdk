// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 3.1.11 — publisher presentation control.
 *
 * Pins:
 *  - `autoOpen` modes: `always` (default, unchanged), `returningUsersOnly`
 *    (skip the load that minted a brand-new user; absent `isNewUser` counts
 *    as returning), `never` (the publisher opens it);
 *  - the server's `experience.autoOpenMode` merges with the client mode —
 *    the most restrictive wins; unknown values are `always`;
 *  - registration runs on configure() in EVERY mode (tracking is never
 *    deferred to presentation time);
 *  - `present()`: waits for an in-flight registration, applies the same
 *    guards as the auto-open, bypasses the day mark + impression cap, never
 *    counts an impression, writes the day mark on close, never throws;
 *  - `holdAutoOpen()` / `releaseAutoOpen()`: hold before configure, nothing
 *    burned while held, release re-runs the check; present() works while held.
 */

const BUNDLE = 'com.presentation.test';
const markKey = (bundle = BUNDLE): string => `winr_last_auto_present_${bundle}`;
const impressionsKey = (bundle = BUNDLE): string => `winr_unregistered_impressions_${bundle}`;
const MARK_KEY = markKey();
const IMPRESSIONS_KEY = impressionsKey();
const VALID_USER = { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace' };

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

const userPayload = {
  claimedToday: false,
  streakDay: 1,
  totalEntries: 0,
  emailConsentStatus: false,
  optedOut: false,
};

/**
 * Mock backend. `register` overrides the registerDevice payload (e.g.
 * `isNewUser`, `sdkConfig`, `giveaway: null`); `registerStatus` makes it a
 * definitive (non-retriable) HTTP rejection; `hangRegister` never answers.
 */
function mockFetch(options: {
  register?: Record<string, unknown>;
  registerStatus?: number;
  hangRegister?: { release: Promise<void> };
  calls: string[];
}) {
  return vi.fn(async (url: unknown) => {
    const respond = (result: unknown) =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ result }),
        text: async () => JSON.stringify({ result }),
      }) as unknown as Response;
    const u = String(url);
    options.calls.push(u);
    if (u.includes('/registerDevice')) {
      if (options.registerStatus) {
        const body = { error: { message: 'bad request', status: 'INVALID_ARGUMENT' } };
        return {
          ok: false,
          status: options.registerStatus,
          headers: { get: () => 'application/json' },
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }
      if (options.hangRegister) await options.hangRegister.release;
      return respond({
        token: fakeJwt(),
        refreshToken: 'rt',
        uuid: 'user-1',
        giveaway,
        isReturningUser: false,
        isNewUser: false,
        sdkConfig: { experience: { autoOpenEnabled: true, unregisteredImpressionCap: 3 } },
        ...userPayload,
        ...options.register,
      });
    }
    if (u.includes('/getActiveGiveaway')) {
      return respond({ giveaway, sdkConfig: null, ...userPayload });
    }
    return respond({ success: true });
  });
}

let calls: string[];

function install(options: Omit<Parameters<typeof mockFetch>[0], 'calls'> = {}): void {
  calls = [];
  (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({ ...options, calls });
}

const registerCalls = (): number => calls.filter((u) => u.includes('/registerDevice')).length;

async function sdk() {
  const { Avafli } = await import('../src/index');
  return Avafli;
}

async function configureSDK(extra: Record<string, unknown> = {}, bundle = BUNDLE): Promise<void> {
  const Avafli = await sdk();
  await Avafli.configure({ apiKey: 'k', bundleId: bundle, user: { ...VALID_USER }, ...extra });
}

/**
 * Tests that fire a synthetic tab focus must silence the SDK instances left
 * behind by EARLIER tests: vi.resetModules() gives each test a fresh module,
 * but the old modules' focus listeners stay attached to the shared window
 * and — with localStorage cleared — would auto-open their own drawer. They
 * all share BUNDLE and read the day mark live, so a same-day mark on BUNDLE
 * silences them; the test under focus configures its own bundle so its own
 * marks stay clean.
 */
function silenceEarlierInstances(): void {
  localStorage.setItem(MARK_KEY, todayString());
}

const host = (): Element | null => document.querySelector('[data-winr="v2"]');
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
const closeButton = (): HTMLButtonElement | null =>
  host()?.shadowRoot?.querySelector('button[aria-label="Close"]') as HTMLButtonElement | null;
const closeDrawer = async (): Promise<void> => {
  await vi.waitFor(() => expect(closeButton()).not.toBeNull());
  closeButton()!.click();
};

describe('3.1.11 publisher presentation control', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
    install();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── autoOpen modes ──

  it('default (no autoOpen): behavior unchanged — registers and auto-opens', async () => {
    await configureSDK();
    expect(registerCalls()).toBe(1);
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it("autoOpen: 'never' — registerDevice still runs on configure(); nothing opens, nothing is burned", async () => {
    const bundle = `${BUNDLE}.never`;
    silenceEarlierInstances();
    await configureSDK({ autoOpen: 'never' }, bundle);
    expect(registerCalls()).toBe(1);
    expect(sessionStorage.getItem('winr_token')).not.toBeNull(); // the session was established
    await settle();
    expect(host()).toBeNull();
    expect(localStorage.getItem(markKey(bundle))).toBeNull();
    expect(localStorage.getItem(impressionsKey(bundle))).toBeNull();
    // A later foreground re-check stays quiet too.
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(host()).toBeNull();
  });

  it("autoOpen: 'returningUsersOnly' — the load that minted a new user does not auto-open (for the whole session)", async () => {
    const bundle = `${BUNDLE}.returning`;
    silenceEarlierInstances();
    install({ register: { isNewUser: true } });
    await configureSDK({ autoOpen: 'returningUsersOnly' }, bundle);
    expect(registerCalls()).toBe(1);
    await settle();
    expect(host()).toBeNull();
    expect(localStorage.getItem(markKey(bundle))).toBeNull();
    // Tab foreground within the same session: still a first-visit session.
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(host()).toBeNull();
  });

  it("autoOpen: 'returningUsersOnly' — a known user auto-opens as normal", async () => {
    install({ register: { isNewUser: false } });
    await configureSDK({ autoOpen: 'returningUsersOnly' });
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it("autoOpen: 'returningUsersOnly' — an older backend without isNewUser counts as returning", async () => {
    install({ register: { isNewUser: undefined } });
    await configureSDK({ autoOpen: 'returningUsersOnly' });
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it("autoOpen: 'returningUsersOnly' — the next load (now a known user) auto-opens", async () => {
    install({ register: { isNewUser: true } });
    await configureSDK({ autoOpen: 'returningUsersOnly' });
    await settle();
    expect(host()).toBeNull();

    // Next page load: the device is known.
    vi.resetModules();
    install({ register: { isNewUser: false } });
    await configureSDK({ autoOpen: 'returningUsersOnly' });
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  // ── server autoOpenMode merge (most restrictive wins) ──

  it("server autoOpenMode: 'never' suppresses the auto-open even with the client default", async () => {
    install({ register: { sdkConfig: { experience: { autoOpenEnabled: true, autoOpenMode: 'never' } } } });
    await configureSDK();
    await settle();
    expect(host()).toBeNull();
    expect(localStorage.getItem(MARK_KEY)).toBeNull();
  });

  it("server autoOpenMode: 'returningUsersOnly' + a new user: no auto-open with the client default", async () => {
    install({
      register: {
        isNewUser: true,
        sdkConfig: { experience: { autoOpenEnabled: true, autoOpenMode: 'returningUsersOnly' } },
      },
    });
    await configureSDK();
    await settle();
    expect(host()).toBeNull();
  });

  it("client 'never' wins over server 'always'", async () => {
    install({ register: { sdkConfig: { experience: { autoOpenEnabled: true, autoOpenMode: 'always' } } } });
    await configureSDK({ autoOpen: 'never' });
    await settle();
    expect(host()).toBeNull();
  });

  it("client 'returningUsersOnly' wins over server 'always' for a new user", async () => {
    install({
      register: { isNewUser: true, sdkConfig: { experience: { autoOpenEnabled: true, autoOpenMode: 'always' } } },
    });
    await configureSDK({ autoOpen: 'returningUsersOnly' });
    await settle();
    expect(host()).toBeNull();
  });

  it("an unknown server autoOpenMode is treated as 'always'", async () => {
    install({ register: { sdkConfig: { experience: { autoOpenEnabled: true, autoOpenMode: 'sometimes' } } } });
    await configureSDK();
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it('server autoOpenEnabled=false stays the hard kill switch under every mode', async () => {
    install({ register: { sdkConfig: { experience: { autoOpenEnabled: false, autoOpenMode: 'always' } } } });
    await configureSDK({ autoOpen: 'always' });
    await settle();
    expect(host()).toBeNull();
  });

  // ── present() ──

  it("present() opens the drawer under autoOpen: 'never'; the day mark is written on close; no impression is counted", async () => {
    await configureSDK({ autoOpen: 'never' });
    const Avafli = await sdk();
    const presented = Avafli.present();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    // On screen: nothing burned yet.
    expect(localStorage.getItem(MARK_KEY)).toBeNull();
    await closeDrawer();
    await expect(presented).resolves.toBe(true);
    expect(localStorage.getItem(MARK_KEY)).toBe(todayString());
    // Explicit invocation never counts against the unregistered cap.
    expect(localStorage.getItem(IMPRESSIONS_KEY)).toBeNull();
    // …and the auto-open does not double-pop that day (earlier tests'
    // instances share BUNDLE, so today's mark silences them too).
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(host()).toBeNull();
  });

  it('present() bypasses the once-per-day mark', async () => {
    localStorage.setItem(MARK_KEY, todayString());
    await configureSDK();
    await settle();
    expect(host()).toBeNull(); // the auto-open honoured the mark
    const Avafli = await sdk();
    const presented = Avafli.present();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await closeDrawer();
    await expect(presented).resolves.toBe(true);
  });

  it('present() bypasses the unregistered impression cap', async () => {
    localStorage.setItem(IMPRESSIONS_KEY, '3');
    await configureSDK();
    await settle();
    expect(host()).toBeNull(); // capped
    const Avafli = await sdk();
    const presented = Avafli.present();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await closeDrawer();
    await expect(presented).resolves.toBe(true);
    expect(localStorage.getItem(IMPRESSIONS_KEY)).toBe('3'); // untouched
  });

  it('present() while the drawer is already on screen is a no-op that resolves true (one host)', async () => {
    await configureSDK({ autoOpen: 'never' });
    const Avafli = await sdk();
    const first = Avafli.present();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await expect(Avafli.present()).resolves.toBe(true);
    expect(document.querySelectorAll('[data-winr="v2"]').length).toBe(1);
    await closeDrawer();
    await expect(first).resolves.toBe(true);
  });

  it('present() resolves false when there is no active giveaway', async () => {
    install({ register: { giveaway: null } });
    await configureSDK({ autoOpen: 'never' });
    const Avafli = await sdk();
    await expect(Avafli.present()).resolves.toBe(false);
    expect(host()).toBeNull();
  });

  it('present() before configure() resolves false — never throws', async () => {
    const Avafli = await sdk();
    await expect(Avafli.present()).resolves.toBe(false);
    expect(host()).toBeNull();
  });

  it('present() while registration is in flight waits for it, then presents', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    install({ hangRegister: { release: gate } });
    const Avafli = await sdk();

    const configured = Avafli.configure({ apiKey: 'k', bundleId: BUNDLE, user: { ...VALID_USER }, autoOpen: 'never' });
    const presented = Avafli.present();
    await settle();
    expect(host()).toBeNull(); // did not race registerDevice

    release();
    await configured;
    await vi.waitFor(() => expect(host()).not.toBeNull());
    expect(registerCalls()).toBe(1);
    await closeDrawer();
    await expect(presented).resolves.toBe(true);
  });

  it('present() resolves false (no throw) when registration failed', async () => {
    install({ registerStatus: 400 });
    const Avafli = await sdk();
    await expect(
      Avafli.configure({ apiKey: 'k', bundleId: BUNDLE, user: { ...VALID_USER }, autoOpen: 'never' })
    ).rejects.toBeTruthy();
    await expect(Avafli.present()).resolves.toBe(false);
    expect(host()).toBeNull();
  });

  it('present() resolves false for an opted-out (RTD) user', async () => {
    install({ register: { optedOut: true } });
    await configureSDK({ autoOpen: 'never' });
    const Avafli = await sdk();
    await expect(Avafli.present()).resolves.toBe(false);
    expect(host()).toBeNull();
  });

  // ── holdAutoOpen() / releaseAutoOpen() ──

  it('holdAutoOpen() before configure() defers the auto-open (nothing burned); releaseAutoOpen() opens it', async () => {
    const bundle = `${BUNDLE}.hold`;
    silenceEarlierInstances();
    const Avafli = await sdk();
    Avafli.holdAutoOpen();
    await configureSDK({}, bundle);
    expect(registerCalls()).toBe(1); // registration is never deferred
    await settle();
    expect(host()).toBeNull();
    expect(localStorage.getItem(markKey(bundle))).toBeNull();
    expect(localStorage.getItem(impressionsKey(bundle))).toBeNull();
    // Foreground re-checks while held stay quiet.
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(host()).toBeNull();

    Avafli.releaseAutoOpen();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await closeDrawer();
    await vi.waitFor(() => expect(localStorage.getItem(markKey(bundle))).toBe(todayString()));
    expect(localStorage.getItem(impressionsKey(bundle))).toBe('1'); // a real auto-open, counted as usual
  });

  it('releaseAutoOpen() still applies the effective mode and the day mark', async () => {
    const Avafli = await sdk();
    Avafli.holdAutoOpen();
    await configureSDK({ autoOpen: 'never' });
    Avafli.releaseAutoOpen();
    await settle();
    expect(host()).toBeNull();

    // And under the default mode a same-day mark keeps it closed.
    vi.resetModules();
    install();
    const Fresh = await sdk();
    localStorage.setItem(MARK_KEY, todayString());
    Fresh.holdAutoOpen();
    await configureSDK();
    Fresh.releaseAutoOpen();
    await settle();
    expect(host()).toBeNull();
  });

  it('hold/release are safe before configure() and idempotent', async () => {
    const Avafli = await sdk();
    expect(() => Avafli.releaseAutoOpen()).not.toThrow();
    Avafli.holdAutoOpen();
    Avafli.holdAutoOpen();
    Avafli.releaseAutoOpen();
    Avafli.releaseAutoOpen();
    await configureSDK();
    await vi.waitFor(() => expect(host()).not.toBeNull()); // no hold left behind
  });

  it('present() works while the auto-open is held', async () => {
    const Avafli = await sdk();
    Avafli.holdAutoOpen();
    await configureSDK();
    await settle();
    expect(host()).toBeNull();
    const presented = Avafli.present();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await closeDrawer();
    await expect(presented).resolves.toBe(true);
    expect(localStorage.getItem(MARK_KEY)).toBe(todayString());
    // The release afterwards finds the day already marked — no double-pop.
    Avafli.releaseAutoOpen();
    await settle();
    expect(host()).toBeNull();
  });
});

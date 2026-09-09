// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AVAFLI_CONSTANTS } from '../src/types';

/**
 * 3.1.10 — "why does it keep asking for my email?" (Sept 9 2026, iPhone
 * Safari on a publisher page). Root cause: the register handler read the
 * backend's `isReturningUser` ("known under ANOTHER publisher") as "this
 * user existed before" and wiped the local email-captured flag on EVERY
 * page load. With 3.1.9's capture-first frame that meant the email screen
 * flashed for every returning single-publisher person, and when the
 * giveaway reconcile lost a race it simply stuck there.
 *
 * Pins:
 *  - only `isNewUser: true` resets local state; a returning single-publisher
 *    user (isReturningUser:false, isNewUser:false) keeps the flag and lands
 *    on the cached dashboard as the FIRST frame — never email capture;
 *  - register's own `emailConsentStatus` settles the gate (true seeds, false
 *    self-heals a stale flag); an older backend that sends neither leaves
 *    local state alone;
 *  - the guest profile write (guaranteed 400: empty first name) is skipped;
 *  - verifyAdoptionCode switches the session to the canonical account;
 *  - the reported SDK version is the package version.
 */

const BUNDLE = 'com.identity.test';
const FLAG = `winr_email_submitted_${BUNDLE}`;

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

type Calls = Array<{ url: string; body: unknown }>;

/** Mock backend. `register` overrides the registerDevice payload; `hangGiveaway` never answers getActiveGiveaway. */
function mockFetch(options: {
  register?: Record<string, unknown>;
  giveaway?: Record<string, unknown>;
  hangGiveaway?: boolean;
  verify?: Record<string, unknown>;
  calls: Calls;
}) {
  return vi.fn(async (url: unknown, init?: { body?: string }) => {
    const respond = (result: unknown) =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ result }),
        text: async () => JSON.stringify({ result }),
      }) as unknown as Response;
    const u = String(url);
    options.calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null });
    if (u.includes('/registerDevice')) {
      return respond({
        token: fakeJwt(),
        refreshToken: 'rt',
        uuid: 'user-1',
        giveaway,
        isReturningUser: false,
        claimedToday: true,
        streakDay: 3,
        totalEntries: 100,
        sdkConfig: { experience: { autoOpenEnabled: true, unregisteredImpressionCap: 3 } },
        ...options.register,
      });
    }
    if (u.includes('/getActiveGiveaway')) {
      if (options.hangGiveaway) return new Promise<Response>(() => {});
      return respond({
        giveaway,
        sdkConfig: null,
        claimedToday: true,
        streakDay: 3,
        totalEntries: 100,
        emailConsentStatus: true,
        ...options.giveaway,
      });
    }
    if (u.includes('/verifyAdoptionCode')) {
      return respond({ success: true, ...options.verify });
    }
    return respond({ success: true });
  });
}

async function configureSDK(user?: Record<string, unknown>): Promise<void> {
  const { Avafli } = await import('../src/index');
  await Avafli.configure({ apiKey: 'k', bundleId: BUNDLE, ...(user ? { user } : {}) });
}

/** A device that has been here before: cached giveaway + streak + the email flag. */
function seedReturningDevice(): void {
  localStorage.setItem(FLAG, 'true');
  localStorage.setItem(AVAFLI_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY, JSON.stringify(giveaway));
  localStorage.setItem(
    AVAFLI_CONSTANTS.STORAGE_KEYS.STREAK_STATE,
    JSON.stringify({ currentDay: 3, lastClaimedDate: new Date().toISOString(), totalEntriesEarned: 100, weeklyCurrent: 0, monthlyCurrent: 0 })
  );
}

const host = (): Element | null => document.querySelector('[data-winr="v2"]');
const shadowText = (): string => host()?.shadowRoot?.textContent ?? '';

describe('3.1.10 register-time identity + email gate', () => {
  let calls: Calls;
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = 'avafli_did=; Max-Age=0; Path=/';
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
    calls = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it('a returning single-publisher user (isReturningUser:false, isNewUser:false) KEEPS the email flag', async () => {
    seedReturningDevice();
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({
      calls,
      register: { isNewUser: false, emailConsentStatus: true },
      hangGiveaway: true,
    });
    await configureSDK();
    expect(localStorage.getItem(FLAG)).toBe('true');
  });

  it('…and the drawer\'s FIRST frame is the cached dashboard, never email capture', async () => {
    seedReturningDevice();
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({
      calls,
      register: { isNewUser: false, emailConsentStatus: true },
      hangGiveaway: true, // nothing but the register response + cache has landed
    });
    await configureSDK();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await vi.waitFor(() => expect(shadowText()).toMatch(/STREAK/i));
    expect(host()!.shadowRoot!.querySelector('input.wv2-email-input')).toBeNull();
  });

  it('the pre-3.1.10 trap: with the OLD semantics this exact response wiped the flag (documented regression)', async () => {
    seedReturningDevice();
    // An older backend: no isNewUser, no emailConsentStatus on register.
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({ calls, hangGiveaway: true });
    await configureSDK();
    // Nothing authoritative arrived → local state is left alone.
    expect(localStorage.getItem(FLAG)).toBe('true');
    await vi.waitFor(() => expect(host()).not.toBeNull());
    await vi.waitFor(() => expect(shadowText()).toMatch(/STREAK/i));
  });

  it('isNewUser:true (the backend MINTED this user) resets the flag and the streak cache', async () => {
    seedReturningDevice();
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({
      calls,
      register: { isNewUser: true, emailConsentStatus: false, claimedToday: false, streakDay: 1, totalEntries: 0 },
      hangGiveaway: true,
    });
    await configureSDK();
    expect(localStorage.getItem(FLAG)).toBeNull();
    await vi.waitFor(() => expect(host()).not.toBeNull());
    // Email capture is the first frame: the email field is on screen, no streak header.
    await vi.waitFor(() => expect(host()!.shadowRoot!.querySelector('input.wv2-email-input')).not.toBeNull());
    expect(shadowText()).not.toMatch(/DAY STREAK/i);
  });

  it('emailConsentStatus:false on register (existing user, server has no email) drops a stale flag', async () => {
    localStorage.setItem(FLAG, 'true');
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({
      calls,
      register: { isNewUser: false, emailConsentStatus: false },
      hangGiveaway: true,
    });
    await configureSDK();
    expect(localStorage.getItem(FLAG)).toBeNull();
  });

  it('emailConsentStatus:true on register seeds the flag on a device whose storage lost it', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({
      calls,
      register: { isNewUser: false, emailConsentStatus: true },
      hangGiveaway: true,
    });
    await configureSDK();
    expect(localStorage.getItem(FLAG)).toBe('true');
  });

  it('a minted guest (no name) never posts an empty profile; a named user still does', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({ calls });
    await configureSDK();
    expect(calls.some((c) => c.url.includes('/submitUserProfile'))).toBe(false);

    vi.resetModules();
    calls.length = 0;
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({ calls });
    await configureSDK({ id: 'u-2', firstName: 'Ada', lastName: 'Lovelace' });
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes('/submitUserProfile'))).toBe(true));
  });

  it('verifyAdoptionCode switches the session to the canonical account', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({
      calls,
      register: { isNewUser: false, emailConsentStatus: false, adoptionPending: true, uuid: 'shell-1' },
      giveaway: { emailConsentStatus: false, adoptionPending: true },
      verify: { adopted: true, uuid: 'canon-1', token: fakeJwt(), refreshToken: 'rt-canon' },
    });
    await configureSDK();
    expect(sessionStorage.getItem(AVAFLI_CONSTANTS.STORAGE_KEYS.UUID)).toBe('shell-1');
    await vi.waitFor(() => expect(host()).not.toBeNull());
    // The parked link routes the open to the code screen.
    const input = await vi.waitFor(() => {
      const i = host()!.shadowRoot!.querySelector('input.wv2-code-input') as HTMLInputElement | null;
      expect(i).not.toBeNull();
      return i!;
    });
    input.value = '123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes('/verifyAdoptionCode'))).toBe(true));
    await vi.waitFor(() => expect(sessionStorage.getItem(AVAFLI_CONSTANTS.STORAGE_KEYS.UUID)).toBe('canon-1'));
    expect(sessionStorage.getItem(AVAFLI_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN)).toBe('rt-canon');
  });

  it('the SDK reports the package version (release-sweep gate)', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    expect(AVAFLI_CONSTANTS.SDK_VERSION).toBe(pkg.version);
  });
});

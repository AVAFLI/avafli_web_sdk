// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AVAFLI_CONSTANTS, AvafliErrorCode } from '../src/types';

/**
 * 3.1.11 — token-refresh hardening (the Sept 24 Skape cold-open failure:
 * parallel authed calls with a dead token → parallel 401s → parallel
 * refreshToken calls → the retry died and the drawer never opened).
 *
 * Pins:
 *  1. proactive expiry pre-check: an expired (or within-60-s) ID token is
 *     refreshed BEFORE the authed request goes out, and the request carries
 *     the new token — no 401 round-trip;
 *  2. single-flight refresh: concurrent callers share ONE `/refreshToken`
 *     call, on both the pre-check path and the reactive 401 path;
 *  3. a failed refresh surfaces AuthenticationRequired once, without a
 *     refresh storm.
 */

const BUNDLE = 'com.tokenrefresh.test';
const TOKEN_KEY = AVAFLI_CONSTANTS.STORAGE_KEYS.TOKEN;
const REFRESH_KEY = AVAFLI_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN;

function jwt(expSeconds: number, tag = 'a'): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ exp: expSeconds, tag })}.sig`;
}
const FAR_FUTURE = 4102444800; // 2100
const now = (): number => Math.floor(Date.now() / 1000);

type Call = { url: string; auth: string | null };

/**
 * Mock backend recording each call's bearer. `reject401For` makes any authed
 * endpoint answer 401 while that exact token is presented; `refreshStatus`
 * makes /refreshToken fail with that HTTP status.
 */
function mockFetch(options: { calls: Call[]; reject401For?: string; refreshStatus?: number; freshToken: string }) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization');
    options.calls.push({ url: u, auth });
    const respond = (result: unknown, status = 200) =>
      ({
        ok: status < 400,
        status,
        headers: { get: () => 'application/json' },
        json: async () => (status < 400 ? { result } : result),
        text: async () => JSON.stringify(status < 400 ? { result } : result),
      }) as unknown as Response;
    if (u.includes('/registerDevice')) {
      return respond({
        token: jwt(FAR_FUTURE, 'boot'),
        refreshToken: 'rt-1',
        uuid: 'user-1',
        giveaway: null,
        isReturningUser: false,
        sdkConfig: { experience: { autoOpenEnabled: false } },
        claimedToday: false,
        streakDay: 1,
        totalEntries: 0,
      });
    }
    if (u.includes('/refreshToken')) {
      if (options.refreshStatus) {
        return respond({ error: { message: 'refresh rejected', status: 'INVALID_ARGUMENT' } }, options.refreshStatus);
      }
      return respond({ token: options.freshToken, refreshToken: 'rt-2' });
    }
    if (options.reject401For && auth === `Bearer ${options.reject401For}`) {
      return respond({ error: { message: 'unauthenticated', status: 'UNAUTHENTICATED' } }, 401);
    }
    return respond({ giveaway: null, sdkConfig: null, claimedToday: false, streakDay: 1, totalEntries: 0 });
  });
}

let calls: Call[];
let fresh: string;

function install(extra: { reject401For?: string; refreshStatus?: number } = {}): void {
  calls = [];
  fresh = jwt(FAR_FUTURE, 'fresh');
  (globalThis as unknown as Record<string, unknown>).fetch = mockFetch({ calls, freshToken: fresh, ...extra });
}

const refreshCalls = (): Call[] => calls.filter((c) => c.url.includes('/refreshToken'));
const giveawayCalls = (): Call[] => calls.filter((c) => c.url.includes('/getActiveGiveaway'));
const indexOfFirst = (needle: string): number => calls.findIndex((c) => c.url.includes(needle));

async function configureSDK() {
  const { Avafli } = await import('../src/index');
  // An id-only user: a named user's fire-and-forget profile write would be
  // an extra authed call in flight during these traces.
  await Avafli.configure({ apiKey: 'k', bundleId: BUNDLE, user: { id: 'u-1' } });
  return Avafli;
}

describe('3.1.11 token-refresh hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    install();
  });
  afterEach(() => vi.restoreAllMocks());

  it('a valid token is used as-is — no refresh round-trip', async () => {
    const Avafli = await configureSDK();
    await Avafli.getAPI().getActiveGiveaway();
    expect(refreshCalls()).toHaveLength(0);
    expect(giveawayCalls()[0]?.auth).toBe(`Bearer ${jwt(FAR_FUTURE, 'boot')}`);
  });

  it('pre-check: an expired token is refreshed BEFORE the authed request, which then carries the new token', async () => {
    const Avafli = await configureSDK();
    // The tab sat open for days: the cached ID token is dead.
    sessionStorage.setItem(TOKEN_KEY, jwt(now() - 3600, 'dead'));

    await Avafli.getAPI().getActiveGiveaway();

    expect(refreshCalls()).toHaveLength(1);
    expect(indexOfFirst('/refreshToken')).toBeLessThan(indexOfFirst('/getActiveGiveaway'));
    expect(giveawayCalls()).toHaveLength(1); // no 401 → retry round-trip
    expect(giveawayCalls()[0]?.auth).toBe(`Bearer ${fresh}`);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(fresh);
    expect(sessionStorage.getItem(REFRESH_KEY)).toBe('rt-2');
  });

  it('pre-check: a token within 60 s of expiry counts as expired', async () => {
    const Avafli = await configureSDK();
    sessionStorage.setItem(TOKEN_KEY, jwt(now() + 30, 'almost'));
    await Avafli.getAPI().getActiveGiveaway();
    expect(refreshCalls()).toHaveLength(1);
    expect(giveawayCalls()[0]?.auth).toBe(`Bearer ${fresh}`);
  });

  it('single-flight: parallel authed calls on a dead token share ONE refresh', async () => {
    const Avafli = await configureSDK();
    sessionStorage.setItem(TOKEN_KEY, jwt(now() - 3600, 'dead'));

    const api = Avafli.getAPI();
    await Promise.all([api.getActiveGiveaway(), api.getActiveGiveaway(), api.getActiveGiveaway()]);

    expect(refreshCalls()).toHaveLength(1);
    expect(giveawayCalls()).toHaveLength(3);
    for (const c of giveawayCalls()) expect(c.auth).toBe(`Bearer ${fresh}`);
  });

  it('single-flight on the reactive path: parallel 401s trigger ONE refresh and every call retries with the new token', async () => {
    // The token looks fine by `exp` but the backend revoked it: the pre-check
    // passes, every call 401s, and the refresh handler is hit concurrently.
    install({ reject401For: jwt(FAR_FUTURE, 'boot') });
    const Avafli = await configureSDK();

    const api = Avafli.getAPI();
    await Promise.all([api.getActiveGiveaway(), api.getActiveGiveaway()]);

    expect(refreshCalls()).toHaveLength(1);
    const retried = giveawayCalls().filter((c) => c.auth === `Bearer ${fresh}`);
    expect(retried).toHaveLength(2);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe(fresh);
  });

  it('a rejected refresh surfaces AuthenticationRequired once — no refresh storm, tokens dropped', async () => {
    const dead = jwt(now() - 3600, 'dead');
    // The backend rejects both the refresh and the dead token itself.
    install({ refreshStatus: 400, reject401For: dead });
    const Avafli = await configureSDK();
    sessionStorage.setItem(TOKEN_KEY, dead);

    const api = Avafli.getAPI();
    const results = await Promise.allSettled([api.getActiveGiveaway(), api.getActiveGiveaway()]);

    expect(refreshCalls()).toHaveLength(1);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason?.code).toBe(AvafliErrorCode.AuthenticationRequired);
    }
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(REFRESH_KEY)).toBeNull();
  });
});

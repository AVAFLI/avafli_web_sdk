// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 3.1.8 — the browser identity is a random per-site id, not a hash of
 * browser signals (which changed with iOS updates / in-app browsers and
 * collided across identical devices). Storage-blocked browsers keep the
 * deterministic hash so a reload is not a new person.
 */
const BUNDLE = 'com.deviceid.test';
const FP_KEY = 'winr_device_fingerprint';

function fakeJwt(): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800 })}.sig`;
}

function okFetch(registerBodies: string[]) {
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
    if (u.includes('/registerDevice')) {
      registerBodies.push(String(init?.body ?? ''));
      return respond({
        token: fakeJwt(), refreshToken: 'rt', uuid: 'user-1', giveaway: null, isReturningUser: false,
        sdkConfig: { experience: { autoOpenEnabled: false } }, claimedToday: false, streakDay: 1, totalEntries: 0,
        emailConsentStatus: false, optedOut: false,
      });
    }
    return respond({ giveaway: null, sdkConfig: null });
  });
}

async function configureSDK(): Promise<void> {
  const { Avafli } = await import('../src/index');
  await Avafli.configure({ apiKey: 'k', bundleId: BUNDLE, user: { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace' } });
}

const sentFingerprint = (body: string): string => JSON.parse(body).data.deviceFingerprint;

describe('browser identity (device id)', () => {
  let bodies: string[];
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    bodies = [];
    (globalThis as unknown as Record<string, unknown>).fetch = okFetch(bodies);
  });
  afterEach(() => vi.restoreAllMocks());

  it('mints a random 24-hex id, stores it, and reuses it on the next load', async () => {
    await configureSDK();
    const id = localStorage.getItem(FP_KEY);
    expect(id).toMatch(/^web_[0-9a-f]{24}$/);
    expect(sentFingerprint(bodies[0])).toBe(id);

    vi.resetModules();
    (globalThis as unknown as Record<string, unknown>).fetch = okFetch(bodies);
    await configureSDK();
    expect(localStorage.getItem(FP_KEY)).toBe(id);
    expect(sentFingerprint(bodies[1])).toBe(id);
  });

  it('two fresh profiles on the same machine never collide', async () => {
    await configureSDK();
    const first = localStorage.getItem(FP_KEY);
    localStorage.clear();
    vi.resetModules();
    (globalThis as unknown as Record<string, unknown>).fetch = okFetch(bodies);
    await configureSDK();
    expect(localStorage.getItem(FP_KEY)).not.toBe(first);
  });

  it('a browser that already holds a hashed id keeps it (no identity change on upgrade)', async () => {
    localStorage.setItem(FP_KEY, 'web_kjjc9g');
    await configureSDK();
    expect(localStorage.getItem(FP_KEY)).toBe('web_kjjc9g');
    expect(sentFingerprint(bodies[0])).toBe('web_kjjc9g');
  });

  it('storage-blocked browser: deterministic short hash, identical across loads', async () => {
    // Site data blocked: any touch of localStorage throws (Safari private mode
    // on older versions, browsers with storage disabled).
    const desc = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('site data blocked'); } });
    try {
    await configureSDK();
    const a = sentFingerprint(bodies[0]);
    expect(a).toMatch(/^web_[0-9a-z]{1,8}$/);
    vi.resetModules();
    (globalThis as unknown as Record<string, unknown>).fetch = okFetch(bodies);
    await configureSDK();
    expect(sentFingerprint(bodies[1])).toBe(a);
    } finally {
      if (desc) Object.defineProperty(window, 'localStorage', desc);
    }
  });
});

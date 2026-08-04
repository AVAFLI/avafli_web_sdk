// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Auto-open engine regression tests (run in a real-ish DOM via happy-dom).
 *
 * Regression under test: when configure() runs before the parser has created
 * <body> (the common "SDK snippet in <head>" integration), mounting the
 * shadow-DOM host used to throw (`document.body.appendChild`), the error was
 * swallowed, and — because the once-per-day mark and the unregistered
 * impression count were written BEFORE presentation — every same-day re-check
 * short-circuited and the SDK stayed silent (permanently, once the impression
 * cap was burned over 3 such days). The fix: defer the eligibility check until
 * DOMContentLoaded when <body> isn't available, and roll the marks back if a
 * presentation fails to mount.
 */

const BUNDLE = 'com.autoopen.test';
const MARK_KEY = `winr_last_auto_present_${BUNDLE}`;
const IMPRESSIONS_KEY = `winr_unregistered_impressions_${BUNDLE}`;

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

/** Successful mock backend (registerDevice / getActiveGiveaway / profile). */
function okFetch() {
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
    if (u.includes('/registerDevice')) {
      return respond({
        token: fakeJwt(),
        refreshToken: 'rt',
        uuid: 'user-1',
        giveaway,
        isReturningUser: false,
        sdkConfig: { experience: { autoOpenEnabled: true, unregisteredImpressionCap: 3 } },
        ...userPayload,
      });
    }
    if (u.includes('/getActiveGiveaway')) {
      return respond({ giveaway, sdkConfig: null, ...userPayload });
    }
    return respond({ success: true });
  });
}

async function configureSDK(): Promise<void> {
  const { WINR } = await import('../src/index');
  await WINR.configure({
    apiKey: 'k',
    bundleId: BUNDLE,
    user: { ...VALID_USER },
  });
}

const host = (): Element | null => document.querySelector('[data-winr="v2"]');

describe('auto-open engine', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    document.querySelectorAll('[data-winr="v2"]').forEach((n) => n.remove());
    (globalThis as unknown as Record<string, unknown>).fetch = okFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fresh profile: auto-opens after configure() and burns the once-per-day mark', async () => {
    await configureSDK();

    await vi.waitFor(() => expect(host()).not.toBeNull());
    expect(localStorage.getItem(MARK_KEY)).toBe(todayString());
    expect(localStorage.getItem(IMPRESSIONS_KEY)).toBe('1');

    // The email-capture CTA carries the renamed copy (2.2.0).
    await vi.waitFor(() => {
      const pill = host()?.shadowRoot?.querySelector('.wv2-pill');
      expect(pill?.textContent).toBe('CLAIM MY 10 ENTRIES');
    });
  });

  it('same-day reload: does NOT re-open', async () => {
    localStorage.setItem(MARK_KEY, todayString());
    await configureSDK();

    // Give the (void) auto-present pass time to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(host()).toBeNull();
    expect(localStorage.getItem(IMPRESSIONS_KEY)).toBeNull();
  });

  it('next day (stale mark): re-opens', async () => {
    localStorage.setItem(MARK_KEY, '2020-01-01');
    await configureSDK();

    await vi.waitFor(() => expect(host()).not.toBeNull());
    expect(localStorage.getItem(MARK_KEY)).toBe(todayString());
  });

  it('REGRESSION: configure() before <body> exists defers (burning nothing) and opens on DOMContentLoaded', async () => {
    // Simulate the parser still being inside <head>: document.body === null.
    const realBody = document.body;
    let bodyReady = false;
    Object.defineProperty(document, 'body', {
      configurable: true,
      get: () => (bodyReady ? realBody : null),
    });

    try {
      await configureSDK();
      await new Promise((r) => setTimeout(r, 50));

      // Nothing mounted, and CRUCIALLY nothing was burned.
      expect(host()).toBeNull();
      expect(localStorage.getItem(MARK_KEY)).toBeNull();
      expect(localStorage.getItem(IMPRESSIONS_KEY)).toBeNull();

      // DOM becomes ready → the deferred check runs and presents.
      bodyReady = true;
      document.dispatchEvent(new Event('DOMContentLoaded'));

      await vi.waitFor(() => expect(host()).not.toBeNull());
      expect(localStorage.getItem(MARK_KEY)).toBe(todayString());
      expect(localStorage.getItem(IMPRESSIONS_KEY)).toBe('1');
    } finally {
      // Restore the prototype getter.
      delete (document as unknown as Record<string, unknown>).body;
    }
  });

  it('REGRESSION: a failed mount rolls back the day mark + impression count so the re-check can retry', async () => {
    // Make the first host attach explode (any mount failure — the pre-fix
    // behavior burned the marks and left the SDK silent for the day).
    const realAppend = document.body.appendChild.bind(document.body);
    let failures = 1;
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node: Node) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('simulated mount failure');
        }
        return realAppend(node);
      });

    await configureSDK();
    await new Promise((r) => setTimeout(r, 50));

    // Presentation failed — and the eligibility marks were rolled back.
    expect(host()).toBeNull();
    expect(localStorage.getItem(MARK_KEY)).toBeNull();
    expect(localStorage.getItem(IMPRESSIONS_KEY)).toBe('0');

    // The SDK's own focus re-check now succeeds (also proves the internal
    // "already on screen" guard was released after the failed mount).
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(host()).not.toBeNull());
    expect(localStorage.getItem(MARK_KEY)).toBe(todayString());
    expect(localStorage.getItem(IMPRESSIONS_KEY)).toBe('1');

    appendSpy.mockRestore();
  });

  it('server kill switch autoOpenEnabled=false suppresses the auto-open', async () => {
    const fetchMock = okFetch();
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: unknown) => {
        const response = await fetchMock(url);
        if (String(url).includes('/registerDevice')) {
          const body = (await response.json()) as { result: Record<string, unknown> };
          body.result.sdkConfig = { experience: { autoOpenEnabled: false } };
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
          } as unknown as Response;
        }
        return response;
      }
    );

    await configureSDK();
    await new Promise((r) => setTimeout(r, 50));
    expect(host()).toBeNull();
    expect(localStorage.getItem(MARK_KEY)).toBeNull();
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * firstName/lastName are optional on AvafliUser (2.6.3). A publisher can configure
 * from whatever identity data they have — even just an id — and the SDK captures
 * the rest (email via its capture screen). These pin that:
 *   - `{ id: 'user_123' }` (no names, no email) configures without the
 *     InvalidConfiguration name error, and the email-capture screen still shows;
 *   - the guest path (omit `user`) still works;
 *   - name validation still runs WHEN a name is actually supplied.
 */

const BUNDLE = 'com.optionalname.test';

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

const host = (): Element | null => document.querySelector('[data-winr="v2"]');

describe('optional firstName/lastName', () => {
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

  it('configures an id-only user (no names, no email) and shows the email-capture screen', async () => {
    const { Avafli } = await import('../src/index');
    await expect(
      Avafli.configure({ apiKey: 'k', bundleId: BUNDLE, user: { id: 'user_123' } })
    ).resolves.toBeUndefined();

    // Email absent → the capture screen must appear (the capture flow), fronted
    // by the renamed CTA.
    await vi.waitFor(() => {
      const pill = host()?.shadowRoot?.querySelector('.wv2-pill');
      expect(pill?.textContent).toBe('CLAIM MY 10 ENTRIES');
    });
  });

  it('still supports the guest path (user omitted)', async () => {
    const { Avafli } = await import('../src/index');
    await expect(
      Avafli.configure({ apiKey: 'k', bundleId: BUNDLE })
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(host()).not.toBeNull());
  });

  it('still validates a name WHEN one is supplied', async () => {
    const { Avafli } = await import('../src/index');
    await expect(
      Avafli.configure({
        apiKey: 'k',
        bundleId: BUNDLE,
        user: { id: 'user_123', firstName: 'J@ne!', lastName: 'Doe' },
      })
    ).rejects.toThrow(/letters, spaces, hyphens/);
  });
});

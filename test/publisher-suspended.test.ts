import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Tests for graceful "publisher suspended" handling.
 *
 * When the backend's registerDevice call rejects with a message containing
 * "suspended"/"revoked" (publisher billing lapse), the SDK must:
 *  - surface a WINRError with code `service_unavailable`,
 *  - report WINR.isAvailable === false and expose WINR.unavailableReason,
 *  - never render the modal from the internal presentation path (the
 *    experience is exclusively auto-opened; there is no public present()),
 *  - cache the state so repeat presentation attempts short-circuit.
 *
 * The internal presentation entry point (WINR['presentExperience']) is
 * TypeScript-private; tests reach it via an unknown-cast to exercise the
 * same code path the auto-open engine uses.
 *
 * The SDK relies on browser globals (navigator/screen/Intl/atob/fetch). We stub
 * the minimum needed and mock fetch per test. Modules are reset between tests so
 * the WINR singleton's static state starts clean.
 */

const VALID_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

/** Reach the SDK-internal (TS-private) presentation entry point. */
function internalPresent(
  WINR: unknown,
  options?: { onError?: (e: unknown) => void }
): Promise<void> {
  return (
    WINR as unknown as {
      presentExperience(opts?: { onError?: (e: unknown) => void }): Promise<void>;
    }
  ).presentExperience(options);
}

function installBrowserGlobals(): void {
  defineGlobal('navigator', { userAgent: 'test', language: 'en-US' });
  defineGlobal('screen', { width: 1024, height: 768, colorDepth: 24 });
  if (typeof (globalThis as unknown as Record<string, unknown>).atob !== 'function') {
    defineGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'));
  }
}

/** Build a fetch mock that fails /registerDevice with the given message. */
function suspendedFetch(message: string) {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/registerDevice')) {
      return {
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ message }),
        json: async () => ({ message }),
      } as unknown as Response;
    }
    // Any other call (e.g. submitUserProfile) succeeds trivially.
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
      text: async () => '{}',
    } as unknown as Response;
  });
}

describe('publisher suspended handling', () => {
  beforeEach(() => {
    vi.resetModules();
    installBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('configure() rejects with a service_unavailable WINRError when suspended', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = suspendedFetch(
      'API key suspended or revoked'
    );
    const { WINR, WINRErrorCode, WINRError } = await import('../src/index');

    await expect(
      WINR.configure({ apiKey: 'k', bundleId: 'com.test', user: { ...VALID_USER } })
    ).rejects.toMatchObject({ code: WINRErrorCode.ServiceUnavailable });

    // And it is a real WINRError instance.
    const err = await WINR.configure({
      apiKey: 'k',
      bundleId: 'com.test',
      user: { ...VALID_USER },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(WINRError);
  });

  it('reports isAvailable=false and exposes unavailableReason after a suspended init', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = suspendedFetch(
      'Publisher account suspended'
    );
    const { WINR, WINRErrorCode } = await import('../src/index');

    await WINR.configure({
      apiKey: 'k',
      bundleId: 'com.test',
      user: { ...VALID_USER },
    }).catch(() => undefined);

    expect(WINR.isAvailable).toBe(false);
    expect(WINR.unavailableReason).not.toBeNull();
    expect(WINR.unavailableReason?.code).toBe(WINRErrorCode.ServiceUnavailable);
  });

  it('the internal presentation path does not render the modal and rejects + calls onError when suspended', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = suspendedFetch(
      'API key suspended or revoked'
    );
    const { WINR, WINRErrorCode } = await import('../src/index');

    await WINR.configure({
      apiKey: 'k',
      bundleId: 'com.test',
      user: { ...VALID_USER },
    }).catch(() => undefined);

    const onError = vi.fn();
    await expect(internalPresent(WINR, { onError })).rejects.toMatchObject({
      code: WINRErrorCode.ServiceUnavailable,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe(WINRErrorCode.ServiceUnavailable);

    // No DOM element should have been created for the modal.
    if (typeof document !== 'undefined') {
      expect(document.querySelector('[class*="winr"]')).toBeNull();
    }
  });

  it('the manual-present public API surface is gone (present/presentInline removed)', async () => {
    const { WINR } = await import('../src/index');
    expect((WINR as unknown as Record<string, unknown>).present).toBeUndefined();
    expect(
      (WINR as unknown as Record<string, unknown>).presentInline
    ).toBeUndefined();
  });

  it('caches the suspended state — repeat presentation attempts do not re-hit the network', async () => {
    const fetchMock = suspendedFetch('API key suspended or revoked');
    (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;
    const { WINR } = await import('../src/index');

    await WINR.configure({
      apiKey: 'k',
      bundleId: 'com.test',
      user: { ...VALID_USER },
    }).catch(() => undefined);

    const callsAfterConfigure = fetchMock.mock.calls.length;

    await internalPresent(WINR).catch(() => undefined);
    await internalPresent(WINR).catch(() => undefined);

    // Short-circuited: no additional network calls were made.
    expect(fetchMock.mock.calls.length).toBe(callsAfterConfigure);
  });

  it('non-suspended registration failures are NOT treated as service_unavailable', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ message: 'internal error' }),
      json: async () => ({ message: 'internal error' }),
    })) as unknown as typeof fetch;
    const { WINR, WINRErrorCode } = await import('../src/index');

    await WINR.configure({
      apiKey: 'k',
      bundleId: 'com.test',
      user: { ...VALID_USER },
    }).catch(() => undefined);

    expect(WINR.unavailableReason).toBeNull();
    // A 500 must not masquerade as service_unavailable.
    const err = await internalPresent(WINR).catch((e) => e);
    expect(err?.code).not.toBe(WINRErrorCode.ServiceUnavailable);
  });
});

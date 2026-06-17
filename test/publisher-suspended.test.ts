import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Tests for graceful "publisher suspended" handling.
 *
 * When the backend's registerDevice call rejects with a message containing
 * "suspended"/"revoked" (publisher billing lapse), the SDK must:
 *  - surface a WINRError with code `service_unavailable`,
 *  - report WINR.isAvailable === false and expose WINR.unavailableReason,
 *  - never render the modal from present()/presentInline() (reject + onError),
 *  - cache the state so repeat calls short-circuit.
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

  it('present() does not render the modal and rejects + calls onError when suspended', async () => {
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
    await expect(WINR.present({ onError })).rejects.toMatchObject({
      code: WINRErrorCode.ServiceUnavailable,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe(WINRErrorCode.ServiceUnavailable);

    // No DOM element should have been created for the modal.
    if (typeof document !== 'undefined') {
      expect(document.querySelector('[class*="winr"]')).toBeNull();
    }
  });

  it('presentInline() short-circuits when suspended', async () => {
    (globalThis as unknown as Record<string, unknown>).fetch = suspendedFetch(
      'Publisher account suspended'
    );
    const { WINR, WINRErrorCode } = await import('../src/index');

    await WINR.configure({
      apiKey: 'k',
      bundleId: 'com.test',
      user: { ...VALID_USER },
    }).catch(() => undefined);

    const onError = vi.fn();
    await expect(
      WINR.presentInline('container', { onError })
    ).rejects.toMatchObject({ code: WINRErrorCode.ServiceUnavailable });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('caches the suspended state — a second present() does not re-hit the network', async () => {
    const fetchMock = suspendedFetch('API key suspended or revoked');
    (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;
    const { WINR } = await import('../src/index');

    await WINR.configure({
      apiKey: 'k',
      bundleId: 'com.test',
      user: { ...VALID_USER },
    }).catch(() => undefined);

    const callsAfterConfigure = fetchMock.mock.calls.length;

    await WINR.present().catch(() => undefined);
    await WINR.present().catch(() => undefined);

    // Short-circuited: no additional network calls were made by present().
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
    const err = await WINR.present().catch((e) => e);
    expect(err?.code).not.toBe(WINRErrorCode.ServiceUnavailable);
  });
});

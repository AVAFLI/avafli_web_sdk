// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 3.3.1 — `options.debug` is wired.
 *
 * Until 3.3.0 the flag was declared on `AvafliOptions` but never read: the
 * shipped bundles logged at `warn` whatever the publisher passed. Pins:
 *  - default (flag absent) → the logger stays at `warn`, no `[DEBUG]` /
 *    `[INFO]` line reaches the console during configure();
 *  - `debug: true` → the shared logger is raised to `debug` and the SDK's
 *    own debug/info lines reach `console.log` prefixed `[Avafli]`;
 *  - `debug: false` is a no-op (never lowers a level already in effect).
 */

const BUNDLE = 'com.debug.test';

function fakeJwt(): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ exp: 4102444800 })}.sig`;
}

function installFetch(): void {
  (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async () => {
    const result = {
      token: fakeJwt(),
      refreshToken: 'rt',
      uuid: 'user-1',
      giveaway: null, // nothing to auto-open — keeps the drawer out of this test
      isReturningUser: false,
      isNewUser: false,
      claimedToday: false,
      streakDay: 0,
      totalEntries: 0,
      emailConsentStatus: false,
      optedOut: false,
    };
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ result }),
      text: async () => JSON.stringify({ result }),
    } as unknown as Response;
  });
}

async function modules() {
  const { Avafli } = await import('../src/index');
  const { logger, LogLevel } = await import('../src/services/logger');
  return { Avafli, logger, LogLevel };
}

describe('3.3.1 options.debug', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    installFetch();
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  const debugLines = (): string[] =>
    log.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.startsWith('[Avafli]') && /\[(DEBUG|INFO)\]/.test(line));

  it('default: the logger stays at warn and no debug/info line is printed', async () => {
    const { Avafli, logger, LogLevel } = await modules();
    expect(logger.getLevel()).toBe(LogLevel.Warn);
    await Avafli.configure({ apiKey: 'k', bundleId: BUNDLE, user: { id: 'u-1' } });
    expect(logger.getLevel()).toBe(LogLevel.Warn);
    expect(debugLines()).toEqual([]);
  });

  it('debug: true raises the shared logger to debug and the SDK lines reach the console', async () => {
    const { Avafli, logger, LogLevel } = await modules();
    await Avafli.configure({
      apiKey: 'k',
      bundleId: BUNDLE,
      user: { id: 'u-1' },
      options: { debug: true },
    });
    expect(logger.getLevel()).toBe(LogLevel.Debug);
    const lines = debugLines();
    expect(lines.some((l) => /\[DEBUG\] Debug logging enabled \(options\.debug\)/.test(l))).toBe(true);
    // A line from deep inside the SDK (the network client) — proves the level
    // change reaches every module that shares the logger, not just configure().
    expect(lines.some((l) => /\[DEBUG\] Making request to .*\/registerDevice/.test(l))).toBe(true);
    expect(lines.some((l) => /\[INFO\] Device registered successfully/.test(l))).toBe(true);
  });

  it('debug: false never lowers a level already in effect', async () => {
    const { Avafli, logger, LogLevel } = await modules();
    logger.setLevel(LogLevel.Debug); // what a development build of the SDK starts at
    await Avafli.configure({
      apiKey: 'k',
      bundleId: BUNDLE,
      user: { id: 'u-1' },
      options: { debug: false },
    });
    expect(logger.getLevel()).toBe(LogLevel.Debug);
  });
});

// @vitest-environment happy-dom
//
// 3.2.2 — RESILIENCE_SPEC: bounded retry for infrastructure refusals.
//
// When a traffic step outruns warm Cloud Run instances the platform answers
// at once with 429/500 and a plain-text body (no JSON). The network client
// must tell that apart from a callable error our own function returned:
//   app error      = callable JSON body `{error:{message,status}}` → never
//                    retried here (our rate limiter, cooldowns, geo, …);
//   infra refusal  = 429/500/502/503/504 with a non-callable body → retried
//                    on 1 s, 2 s, 4 s, 8 s base delays, full jitter, 250 ms
//                    floor, `Retry-After` honoured up to 10 s.
// The offline queue's transport-only classifier is unchanged: an exhausted
// infra refusal carries an httpStatus and is NOT queued.
//
// Mirrors the six cases in the spec; sleep is injected and driven by fake
// timers, jitter is pinned at 0.5 so every delay is deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkClient, isInfraRefusal } from '../src/network/client';
import {
  OfflineRetryCoordinator,
  isRetriableNetworkError,
  type OfflineStateStore,
} from '../src/offline/offline-resilience';
import { AvafliError, AvafliErrorCode, type Logger } from '../src/types';

// ─── Fakes ───

const INFRA_TEXT = 'The request was aborted because there was no available instance.';
const HTML_503 = '<html><body><h1>503 Service Unavailable</h1></body></html>';

type FakeResponse = {
  status: number;
  body: string;
  contentType?: string;
  retryAfter?: string;
};

/** Response-like object in the shape the other network tests stub. */
function respond(r: FakeResponse): Response {
  const headers: Record<string, string> = {
    'content-type': r.contentType ?? (r.status < 400 ? 'application/json' : 'text/plain'),
  };
  if (r.retryAfter !== undefined) headers['retry-after'] = r.retryAfter;
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => r.body,
    json: async () => JSON.parse(r.body),
  } as unknown as Response;
}

const SUCCESS: FakeResponse = { status: 200, body: JSON.stringify({ result: { ok: true } }) };

function callable(status: number, message: string, code: string): FakeResponse {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message, status: code } }),
  };
}

/** A fetch stub that answers the queued responses in order. */
function mockFetch(queue: FakeResponse[]) {
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch called more times than responses were queued');
    return respond(next);
  });
}

class SpyLogger implements Logger {
  public debug = vi.fn<(message: string, ...args: unknown[]) => void>();
  public info = vi.fn();
  public warn = vi.fn();
  public error = vi.fn();
  retryLines(): string[] {
    return this.debug.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /Infrastructure refusal/.test(m));
  }
}

function fakeStore(): OfflineStateStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Jitter pinned at 0.5 → delays 750, 1250, 2250, 4250 ms. */
const JITTER = 0.5;
const EXPECTED_DELAYS = [750, 1250, 2250, 4250];
const WORST_CASE_MS = (1000 + 2000 + 4000 + 8000) + 4 * 250;

function makeClient(queue: FakeResponse[], logger: SpyLogger) {
  const sleeps: number[] = [];
  const client = new NetworkClient({
    baseURL: 'https://api.test',
    apiKey: 'k',
    logger,
    random: () => JITTER,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  });
  (globalThis as unknown as Record<string, unknown>).fetch = mockFetch(queue);
  return { client, sleeps };
}

/** Drive a pending request to completion under fake timers. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const guarded = p.then(
    (v) => { done = true; return v; },
    (e) => { done = true; throw e; }
  );
  // Swallow here; the caller awaits `guarded` and sees the rejection.
  guarded.catch(() => undefined);
  while (!done) {
    await vi.advanceTimersByTimeAsync(50);
  }
  return guarded;
}

let logger: SpyLogger;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  logger = new SpyLogger();
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as unknown as Record<string, unknown>).fetch = originalFetch;
});

// ─── Classifier ───

describe('isInfraRefusal', () => {
  it('is 429/500/502/503/504 with a NON-callable body', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isInfraRefusal(status, false)).toBe(true);
      expect(isInfraRefusal(status, true)).toBe(false);
    }
    for (const status of [400, 401, 403, 404, 409, 501]) {
      expect(isInfraRefusal(status, false)).toBe(false);
    }
  });
});

// ─── The six spec cases ───

describe('infra refusal retry (RESILIENCE_SPEC)', () => {
  it('1. 429 with a plain-text body is retried and succeeds on attempt 3', async () => {
    const { client, sleeps } = makeClient(
      [
        { status: 429, body: INFRA_TEXT },
        { status: 429, body: INFRA_TEXT },
        SUCCESS,
      ],
      logger
    );
    const started = Date.now();

    const result = await settle(client.post('/claimDailyEntries', { x: 1 }));

    expect(result).toEqual({ ok: true });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect(sleeps).toEqual(EXPECTED_DELAYS.slice(0, 2));

    // Debug lines: one per attempt that went out, plus one per retry carrying
    // status, attempt and delay.
    const attemptLines = logger.debug.mock.calls.filter((c) => /Making request/.test(String(c[0])));
    expect(attemptLines).toHaveLength(3);
    const retries = logger.retryLines();
    expect(retries).toHaveLength(2);
    expect(retries[0]).toMatch(/HTTP 429/);
    expect(retries[0]).toMatch(/750ms/);
    expect(retries[0]).toMatch(/attempt 1\/5/);
    expect(retries[1]).toMatch(/1250ms/);
    expect(retries[1]).toMatch(/attempt 2\/5/);

    // Total elapsed sits inside the schedule: each delay in [250, base + 250].
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(750 + 1250);
    expect(elapsed).toBeLessThanOrEqual(WORST_CASE_MS);
  });

  it('2. 503 with an HTML body is retried the same way', async () => {
    const { client, sleeps } = makeClient(
      [
        { status: 503, body: HTML_503, contentType: 'text/html' },
        { status: 503, body: HTML_503, contentType: 'text/html' },
        SUCCESS,
      ],
      logger
    );
    const started = Date.now();

    const result = await settle(client.post('/getActiveGiveaway', {}));

    expect(result).toEqual({ ok: true });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect(sleeps).toEqual(EXPECTED_DELAYS.slice(0, 2));
    expect(logger.retryLines()).toHaveLength(2);
    expect(logger.retryLines()[0]).toMatch(/HTTP 503/);
    expect(Date.now() - started).toBeLessThanOrEqual(WORST_CASE_MS);
  });

  it('3. 429 with a callable RESOURCE_EXHAUSTED body is NOT retried', async () => {
    const { client, sleeps } = makeClient(
      [callable(429, 'Too many requests. Please try again later.', 'RESOURCE_EXHAUSTED'), SUCCESS],
      logger
    );

    const err = await settle(client.post('/claimDailyEntries', {}).catch((e: unknown) => e));

    expect(err).toBeInstanceOf(AvafliError);
    expect((err as AvafliError).httpStatus).toBe(429);
    expect((err as AvafliError).message).toBe('Too many requests. Please try again later.');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(sleeps).toEqual([]);
    expect(logger.retryLines()).toEqual([]);
  });

  it('4. 400 callable error is NOT retried', async () => {
    const { client, sleeps } = makeClient(
      [callable(400, "You've already entered today on another device. Come back tomorrow!", 'INVALID_ARGUMENT'), SUCCESS],
      logger
    );

    const err = await settle(client.post('/claimDailyEntries', {}).catch((e: unknown) => e));

    expect(err).toBeInstanceOf(AvafliError);
    expect((err as AvafliError).code).toBe(AvafliErrorCode.InvalidState);
    expect((err as AvafliError).httpStatus).toBe(400);
    expect((err as AvafliError).message).toMatch(/already entered today/);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('5. exhausted after 4 retries → NetworkError with httpStatus, and the offline queue does NOT enqueue', async () => {
    const { client, sleeps } = makeClient(
      Array.from({ length: 5 }, () => ({ status: 503, body: INFRA_TEXT })),
      logger
    );
    const started = Date.now();

    const err = await settle(client.post('/registerDevice', {}).catch((e: unknown) => e));

    expect(err).toBeInstanceOf(AvafliError);
    expect((err as AvafliError).code).toBe(AvafliErrorCode.NetworkError);
    expect((err as AvafliError).httpStatus).toBe(503);
    expect((err as AvafliError).message).toBe('Request failed after 5 attempts');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(5);
    expect(sleeps).toEqual(EXPECTED_DELAYS);
    expect(logger.retryLines()).toHaveLength(4);
    expect(Date.now() - started).toBeLessThanOrEqual(WORST_CASE_MS);

    // The server answered (it was just busy): the transport-only classifier
    // says no, and the same gate the SDK applies leaves the queue empty.
    expect(isRetriableNetworkError(err)).toBe(false);
    const store = fakeStore();
    const coordinator = new OfflineRetryCoordinator({
      store,
      bundleId: 'com.test',
      dayKeyProvider: () => '2026-10-15',
      backoffDelaysMs: [0, 0, 0, 0, 0],
    });
    if (isRetriableNetworkError(err)) coordinator.enqueue('registration');
    expect(coordinator.pendingKinds()).toEqual([]);
    expect(store.map.has('winr_offline_pending_intents_com.test')).toBe(false);
    coordinator.shutdown();
  });

  it('6. Retry-After: 3 makes the first delay ≈3 s', async () => {
    const { client, sleeps } = makeClient(
      [
        { status: 429, body: INFRA_TEXT, retryAfter: '3' },
        { status: 429, body: INFRA_TEXT },
        SUCCESS,
      ],
      logger
    );

    const result = await settle(client.post('/claimDailyEntries', {}));

    expect(result).toEqual({ ok: true });
    expect(sleeps[0]).toBe(3000);
    expect(sleeps[0]).toBeGreaterThanOrEqual(250);
    expect(sleeps[0]).toBeLessThanOrEqual(10000);
    // Without the header the second retry falls back to the jittered schedule.
    expect(sleeps[1]).toBe(EXPECTED_DELAYS[1]);
    expect(logger.retryLines()[0]).toMatch(/3000ms/);
  });

  it('Retry-After is capped at 10 s and floored at 250 ms', async () => {
    const { client, sleeps } = makeClient(
      [
        { status: 503, body: INFRA_TEXT, retryAfter: '120' },
        { status: 503, body: INFRA_TEXT, retryAfter: '0' },
        SUCCESS,
      ],
      logger
    );

    await settle(client.post('/claimDailyEntries', {}));

    expect(sleeps).toEqual([10000, 250]);
  });
});

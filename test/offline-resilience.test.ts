// @vitest-environment happy-dom
//
// Offline resilience (launch item 15): same-day retry queue for
// registration/claims plus the bounded offline analytics buffer. Mirrors the
// iOS OfflineResilienceTests / Android OfflineResilienceTest / Flutter
// offline_resilience_test.

import { describe, expect, it, vi } from 'vitest';
import {
  BufferingAnalyticsAdapter,
  OfflineRetryCoordinator,
  isAlreadyClaimedRejection,
  isRetriableNetworkError,
  type OfflineStateStore,
  type RetryOutcome,
} from '../src/offline/offline-resilience';
import { AvafliError, AvafliErrorCode, AnalyticsAdapter } from '../src/types';

// ─── Fakes ───

function fakeStore(seed: Record<string, string> = {}): OfflineStateStore & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

class SpyAdapter implements AnalyticsAdapter {
  public events: Array<{ event: string; properties?: Record<string, unknown> }> = [];
  track(event: string, properties?: Record<string, unknown>): void {
    this.events.push(properties ? { event, properties } : { event });
  }
  identify(): void {}
}

const PENDING_KEY = 'winr_offline_pending_intents_com.test';
const BUFFER_KEY = 'winr_offline_analytics_buffer_com.test';

function flushTasks(times = 3): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) {
    p = p.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
  return p;
}

// ─── Classifier ───

describe('isRetriableNetworkError', () => {
  it('treats a NetworkError WITHOUT httpStatus (transport/timeout) as retriable', () => {
    const transport = new AvafliError(AvafliErrorCode.NetworkError, 'Request timeout after 10000ms');
    expect(isRetriableNetworkError(transport)).toBe(true);
  });

  it('treats a raw fetch TypeError as retriable', () => {
    expect(isRetriableNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('never retries an error carrying an httpStatus — 4xx AND 5xx', () => {
    for (const status of [400, 403, 404, 409, 429, 500, 503]) {
      const err = new AvafliError(AvafliErrorCode.NetworkError, `HTTP ${status}`);
      err.httpStatus = status;
      expect(isRetriableNetworkError(err)).toBe(false);
    }
  });

  it('never retries auth / service-unavailable / other coded errors', () => {
    expect(
      isRetriableNetworkError(
        new AvafliError(AvafliErrorCode.AuthenticationRequired, 'auth')
      )
    ).toBe(false);
    expect(
      isRetriableNetworkError(
        new AvafliError(AvafliErrorCode.ServiceUnavailable, 'suspended')
      )
    ).toBe(false);
    expect(isRetriableNetworkError(new Error('boom'))).toBe(false);
  });
});

describe('isAlreadyClaimedRejection', () => {
  it('matches the backend daily-dedup messages', () => {
    expect(
      isAlreadyClaimedRejection(new Error('Already claimed daily entries today'))
    ).toBe(true);
    expect(isAlreadyClaimedRejection(new Error('Already claimed today'))).toBe(true);
    expect(
      isAlreadyClaimedRejection(
        new Error("You've already entered today on another device. Come back tomorrow!")
      )
    ).toBe(true);
    expect(isAlreadyClaimedRejection(new Error('Request timeout'))).toBe(false);
  });
});

// ─── Retry coordinator ───

describe('OfflineRetryCoordinator', () => {
  function makeCoordinator(
    store: OfflineStateStore,
    options: { dayKey?: () => string } = {}
  ): OfflineRetryCoordinator {
    return new OfflineRetryCoordinator({
      store,
      bundleId: 'com.test',
      dayKeyProvider: options.dayKey ?? (() => '2026-09-01'),
      backoffDelaysMs: [0, 0, 0, 0, 0],
    });
  }

  it('persists the intent across coordinator instances (relaunch)', async () => {
    const store = fakeStore();
    const first = makeCoordinator(store);
    first.enqueue('claim');
    expect(first.pendingKinds()).toEqual(['claim']);
    first.shutdown();

    const second = makeCoordinator(store);
    expect(second.pendingKinds()).toEqual(['claim']);
    second.shutdown();
  });

  it('uses the winr_ + bundleId storage key', () => {
    const store = fakeStore();
    const coordinator = makeCoordinator(store);
    coordinator.enqueue('claim');
    expect(store.map.has(PENDING_KEY)).toBe(true);
    coordinator.shutdown();
  });

  it('clear removes only that kind; re-enqueue keeps one intent per kind', () => {
    const store = fakeStore();
    const coordinator = makeCoordinator(store);
    coordinator.enqueue('claim');
    coordinator.enqueue('claim');
    coordinator.enqueue('registration');
    coordinator.clear('claim');
    expect(coordinator.pendingKinds()).toEqual(['registration']);
    coordinator.shutdown();
  });

  it('SAME-DAY GUARD: drops an intent once its local day ends', () => {
    const store = fakeStore();
    let today = '2026-09-01';
    const coordinator = makeCoordinator(store, { dayKey: () => today });
    coordinator.enqueue('claim');
    expect(coordinator.pendingKinds()).toEqual(['claim']);

    // Cross local midnight — dropped, not replayed: server-authoritative day
    // windows make a stale-day claim a NEW-day claim, which is the auto-open
    // engine's decision.
    today = '2026-09-02';
    expect(coordinator.pendingKinds()).toEqual([]);
    expect(store.map.has(PENDING_KEY)).toBe(false);
    coordinator.shutdown();
  });

  it('success clears the intent after one attempt', async () => {
    const store = fakeStore();
    const coordinator = makeCoordinator(store);
    const handler = vi.fn<(k: unknown) => Promise<RetryOutcome>>(
      async () => 'success'
    );
    coordinator.retryHandler = handler;
    coordinator.enqueue('claim');
    await flushTasks();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(coordinator.pendingKinds()).toEqual([]);
    coordinator.shutdown();
  });

  it('permanent failure drops the intent', async () => {
    const store = fakeStore();
    const coordinator = makeCoordinator(store);
    const handler = vi.fn<(k: unknown) => Promise<RetryOutcome>>(
      async () => 'permanentFailure'
    );
    coordinator.retryHandler = handler;
    coordinator.enqueue('claim');
    await flushTasks();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(coordinator.pendingKinds()).toEqual([]);
    coordinator.shutdown();
  });

  it('retriable failure keeps the intent for the next session', async () => {
    const store = fakeStore();
    const coordinator = makeCoordinator(store);
    coordinator.retryHandler = async () => 'retriableFailure';
    coordinator.enqueue('claim');
    await flushTasks(10);
    expect(coordinator.pendingKinds()).toEqual(['claim']);
    coordinator.shutdown();
  });

  it('HARD cap: at most 5 attempts per session across every trigger', async () => {
    const store = fakeStore();
    const coordinator = makeCoordinator(store);
    const handler = vi.fn<(k: unknown) => Promise<RetryOutcome>>(
      async () => 'retriableFailure'
    );
    coordinator.retryHandler = handler;
    coordinator.enqueue('claim');
    await flushTasks(12); // full (instant) backoff schedule

    for (let i = 0; i < 20; i++) {
      coordinator.noteConnectivityRegained();
      coordinator.noteForeground();
      coordinator.noteLaunch();
      await flushTasks(2);
    }

    expect(handler).toHaveBeenCalledTimes(OfflineRetryCoordinator.maxAttemptsPerSession);
    expect(coordinator.attemptCount('claim')).toBe(
      OfflineRetryCoordinator.maxAttemptsPerSession
    );
    // Persisted for the NEXT page load (fresh cap).
    expect(coordinator.pendingKinds()).toEqual(['claim']);
    coordinator.shutdown();
  });

  it('drops a corrupt persisted queue instead of crashing', () => {
    const store = fakeStore({ [PENDING_KEY]: 'not json {{{' });
    const coordinator = makeCoordinator(store);
    expect(coordinator.pendingKinds()).toEqual([]);
    expect(store.map.has(PENDING_KEY)).toBe(false);
    coordinator.shutdown();
  });
});

// ─── Buffering analytics adapter ───

describe('BufferingAnalyticsAdapter', () => {
  function makeAdapter(
    store: OfflineStateStore,
    spy: SpyAdapter,
    online: () => boolean,
    now?: () => number
  ): BufferingAnalyticsAdapter {
    return new BufferingAnalyticsAdapter({
      inner: spy,
      store,
      bundleId: 'com.test',
      isOnline: online,
      ...(now ? { now } : {}),
    });
  }

  it('passes events straight through while online', () => {
    const spy = new SpyAdapter();
    const adapter = makeAdapter(fakeStore(), spy, () => true);
    adapter.track('avafli_modal_presented', { giveaway_id: 'g1' });
    expect(spy.events).toHaveLength(1);
    expect(adapter.bufferedCount).toBe(0);
  });

  it('buffers events while offline (persisted, not forwarded)', () => {
    const store = fakeStore();
    const spy = new SpyAdapter();
    const adapter = makeAdapter(store, spy, () => false);
    adapter.track('e1', { a: 1 });
    adapter.track('e2');
    expect(spy.events).toHaveLength(0);
    expect(adapter.bufferedCount).toBe(2);
    expect(store.map.has(BUFFER_KEY)).toBe(true);
  });

  it('persists the buffer across adapter instances (next load)', () => {
    const store = fakeStore();
    const spy = new SpyAdapter();
    let online = false;
    makeAdapter(store, spy, () => online).track('e1');

    const secondLoad = makeAdapter(store, spy, () => online);
    expect(secondLoad.bufferedCount).toBe(1);
    online = true;
    secondLoad.flush();
    expect(spy.events.map((e) => e.event)).toEqual(['e1']);
    expect(secondLoad.bufferedCount).toBe(0);
  });

  it('flushes in order with original timestamps attached', () => {
    const store = fakeStore();
    const spy = new SpyAdapter();
    let online = false;
    let now = 1756600000000;
    const adapter = makeAdapter(store, spy, () => online, () => now);
    adapter.track('first', { n: 1 });
    now += 60000;
    adapter.track('second', { n: 2 });

    online = true;
    adapter.flush();

    expect(spy.events.map((e) => e.event)).toEqual(['first', 'second']);
    expect(spy.events[0]?.properties).toMatchObject({
      n: 1,
      original_timestamp: new Date(1756600000000).toISOString(),
      original_timestamp_ms: 1756600000000,
    });
    expect(spy.events[1]?.properties?.['original_timestamp_ms']).toBe(1756600060000);
  });

  it('HARD cap: ring buffer drops oldest beyond 100', () => {
    const store = fakeStore();
    const spy = new SpyAdapter();
    let online = false;
    const adapter = makeAdapter(store, spy, () => online);
    for (let i = 0; i < BufferingAnalyticsAdapter.capacity + 25; i++) {
      adapter.track(`e${i}`);
    }
    expect(adapter.bufferedCount).toBe(BufferingAnalyticsAdapter.capacity);

    online = true;
    adapter.flush();
    expect(spy.events).toHaveLength(BufferingAnalyticsAdapter.capacity);
    expect(spy.events[0]?.event).toBe('e25');
    expect(spy.events.at(-1)?.event).toBe(
      `e${BufferingAnalyticsAdapter.capacity + 24}`
    );
  });

  it('a live event after reconnect flushes the backlog first (order preserved)', () => {
    const store = fakeStore();
    const spy = new SpyAdapter();
    let online = false;
    const adapter = makeAdapter(store, spy, () => online);
    adapter.track('buffered');

    online = true;
    adapter.track('live');

    expect(spy.events.map((e) => e.event)).toEqual(['buffered', 'live']);
    expect(adapter.bufferedCount).toBe(0);
  });

  it('flushIfOnline is a no-op while offline; empty flush is a no-op', () => {
    const store = fakeStore();
    const spy = new SpyAdapter();
    const adapter = makeAdapter(store, spy, () => false);
    adapter.track('e1');
    adapter.flushIfOnline();
    expect(spy.events).toHaveLength(0);
    expect(adapter.bufferedCount).toBe(1);

    const emptyAdapter = makeAdapter(fakeStore(), spy, () => true);
    emptyAdapter.flush();
    expect(spy.events).toHaveLength(0);
  });

  it('drops a corrupt persisted buffer instead of crashing', () => {
    const store = fakeStore({ [BUFFER_KEY]: '}{ not json' });
    const spy = new SpyAdapter();
    const adapter = makeAdapter(store, spy, () => true);
    adapter.flush();
    expect(spy.events).toHaveLength(0);
    expect(store.map.has(BUFFER_KEY)).toBe(false);
  });
});

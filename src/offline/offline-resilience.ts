import {
  AnalyticsAdapter,
  AvafliError,
  AvafliErrorCode,
  AVAFLI_CONSTANTS,
} from '../types';
import { logger } from '../services/logger';

/**
 * Offline resilience (launch item 15): transient network drops must not cause
 * lost streaks or distorted DAU. Scope is deliberately SAME-DAY only — a
 * pending intent is dropped when its local calendar day ends. Cross-midnight
 * backdated replay is explicitly out of scope: the backend's day windows are
 * server-authoritative (a governed anti-fraud contract; the claim transaction
 * keys dedup + streak math off `todayDateString(userTz)` /
 * `current_entry_date`), so a client replaying yesterday's claim after
 * midnight would simply be re-windowed into the new day. Whether the NEW
 * day's claim happens is the auto-open engine's decision, not a stale
 * queue's.
 *
 * Duplicate-retry safety (verified against the backend claim transaction):
 * claimDailyEntries dedups server-side by the canonical user's local-day
 * entry window and `daily_last_claimed === today`, throwing an
 * `already-exists` callable error ("Already claimed…" / "You've already
 * entered today…"). A duplicate retry therefore can never double-grant; an
 * already-claimed rejection is treated as SUCCESS by the retry handler.
 *
 * Mirrors the iOS reference implementation
 * (AvafliSDK/Services/Offline/OfflineResilience.swift).
 */

// ─── Network error classification ───

/**
 * Splits NETWORK-class failures (the request never completed: offline,
 * timeout, connection dropped) from backend rejections. Only the former are
 * safe to retry automatically — a rejection would just be rejected again.
 *
 * The discriminator is the ABSENCE of `httpStatus` on a NetworkError-coded
 * AvafliError: the client stamps the status on every real HTTP response
 * (4xx rejections AND 5xx — transport-only policy, matching iOS), so no
 * status means fetch itself failed (TypeError) or the request timed out.
 */
export function isRetriableNetworkError(error: unknown): boolean {
  if (error instanceof AvafliError) {
    return (
      error.code === AvafliErrorCode.NetworkError &&
      error.httpStatus === undefined
    );
  }
  // A raw fetch failure that escaped the client's wrapping.
  return error instanceof TypeError;
}

/** The backend's `already-exists` daily-dedup messages. */
export function isAlreadyClaimedRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already claimed|already entered today/i.test(message);
}

// ─── Pending intent ───

export type PendingIntentKind = 'registration' | 'claim';

/** A registration or claim the user meant to happen but the network dropped. */
export interface PendingIntent {
  kind: PendingIntentKind;
  /**
   * Local calendar day (yyyy-MM-dd, device zone) the intent was created.
   * The same-day guard drops the intent once this day ends.
   */
  dayKey: string;
  createdAtMs: number;
}

/** Result of one retry attempt, as reported by the retry handler. */
export type RetryOutcome = 'success' | 'permanentFailure' | 'retriableFailure';

/** Minimal synchronous string store (localStorage-shaped). */
export interface OfflineStateStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function localDayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// ─── Retry coordinator ───

/**
 * Persists pending register/claim intents and retries them on connectivity
 * regain (the window `online` event), tab foreground, and a capped
 * exponential backoff while the page lives. HARD caps everywhere: at most
 * {@link OfflineRetryCoordinator.maxAttemptsPerSession} attempts per intent
 * kind per page session, and the backoff chain runs a finite schedule then
 * stops — nothing unbounded, and the chain is torn down the moment the queue
 * is empty.
 */
export class OfflineRetryCoordinator {
  public static readonly maxAttemptsPerSession = 5;

  /** Finite backoff schedule (ms) — 5 slots, the session attempt cap. */
  public static readonly defaultBackoffDelaysMs = [
    2_000, 4_000, 8_000, 16_000, 32_000,
  ];

  /** Performs the actual retry for a kind. Set once at wiring time. */
  public retryHandler?: (kind: PendingIntentKind) => Promise<RetryOutcome>;

  private readonly storageKey: string;
  private readonly attemptsThisSession = new Map<PendingIntentKind, number>();
  private backoffIndex = 0;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private passInFlight = false;
  private shutDown = false;

  constructor(
    private readonly options: {
      store: OfflineStateStore;
      bundleId: string;
      dayKeyProvider?: () => string;
      now?: () => number;
      backoffDelaysMs?: number[];
    }
  ) {
    // Same winr_ + bundleId-suffix namespace as the SDK's other persisted
    // keys (wire/storage compat is intentionally pre-rebrand).
    this.storageKey = `${AVAFLI_CONSTANTS.STORAGE_KEYS.OFFLINE_PENDING_INTENTS}_${options.bundleId}`;
  }

  private get dayKey(): string {
    return this.options.dayKeyProvider?.() ?? localDayKey();
  }

  private get backoffDelaysMs(): number[] {
    return (
      this.options.backoffDelaysMs ??
      OfflineRetryCoordinator.defaultBackoffDelaysMs
    );
  }

  // ─── Queue ───

  /**
   * Records a pending intent (one per kind — re-enqueueing refreshes the day
   * key) and arms the in-session backoff retry chain.
   */
  public enqueue(kind: PendingIntentKind): void {
    const intents = this.loadIntents().filter((i) => i.kind !== kind);
    intents.push({
      kind,
      dayKey: this.dayKey,
      createdAtMs: this.options.now?.() ?? Date.now(),
    });
    this.saveIntents(intents);
    logger.info(`Offline retry queued: ${kind}`);
    this.armBackoff();
  }

  public clear(kind: PendingIntentKind): void {
    this.saveIntents(this.loadIntents().filter((i) => i.kind !== kind));
  }

  /** Currently pending kinds, after the same-day guard pruned stale ones. */
  public pendingKinds(): PendingIntentKind[] {
    return this.prune().map((i) => i.kind);
  }

  public attemptCount(kind: PendingIntentKind): number {
    return this.attemptsThisSession.get(kind) ?? 0;
  }

  // ─── Triggers ───

  /** Connectivity regained (window `online`) — retry immediately. */
  public noteConnectivityRegained(): void {
    void this.attemptNow();
  }

  /** Tab foregrounded (visibilitychange/focus) — retry immediately. */
  public noteForeground(): void {
    void this.attemptNow();
  }

  /** Page load / configure — retry whatever survived the same-day guard. */
  public noteLaunch(): void {
    void this.attemptNow();
  }

  /** Tears down timers (re-configures and tests). */
  public shutdown(): void {
    this.shutDown = true;
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  // ─── Internals ───

  private async attemptNow(): Promise<void> {
    if (this.shutDown || this.passInFlight) return;
    if (this.pendingKinds().length === 0) return;
    await this.performPass();
  }

  /**
   * One retry pass over the pending kinds. Every attempt counts toward the
   * hard per-session cap regardless of which trigger fired it.
   */
  private async performPass(): Promise<void> {
    const handler = this.retryHandler;
    if (!handler || this.passInFlight) return;
    this.passInFlight = true;
    try {
      for (const kind of this.pendingKinds()) {
        const attempts = this.attemptsThisSession.get(kind) ?? 0;
        if (attempts >= OfflineRetryCoordinator.maxAttemptsPerSession) continue;
        this.attemptsThisSession.set(kind, attempts + 1);

        const outcome = await handler(kind);
        if (outcome === 'success') {
          logger.info(`Offline retry succeeded: ${kind}`);
          this.clear(kind);
        } else if (outcome === 'permanentFailure') {
          logger.info(`Offline retry permanently rejected: ${kind} — dropping`);
          this.clear(kind);
        } else {
          logger.debug(`Offline retry still failing: ${kind}`);
        }
      }
    } finally {
      this.passInFlight = false;
    }
  }

  /**
   * Arms the capped exponential-backoff chain: a finite series of setTimeout
   * hops (5 slots, ~62s total) that stops the moment the queue empties, the
   * session cap is reached, or the coordinator shuts down — never an
   * unbounded timer.
   */
  private armBackoff(): void {
    if (this.shutDown || this.backoffTimer !== null) return;
    const delays = this.backoffDelaysMs;
    if (this.backoffIndex >= delays.length) return;
    const delay = delays[this.backoffIndex] ?? 0;
    this.backoffIndex += 1;
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      void (async () => {
        if (this.shutDown) return;
        if (this.pendingKinds().length === 0) return;
        if (this.allKindsCapped()) return;
        await this.performPass();
        if (this.pendingKinds().length > 0 && !this.allKindsCapped()) {
          this.armBackoff();
        }
      })();
    }, delay);
  }

  private allKindsCapped(): boolean {
    const kinds: PendingIntentKind[] = ['registration', 'claim'];
    return kinds.every(
      (kind) =>
        (this.attemptsThisSession.get(kind) ?? 0) >=
        OfflineRetryCoordinator.maxAttemptsPerSession
    );
  }

  // ─── Persistence ───

  private loadIntents(): PendingIntent[] {
    const raw = this.options.store.getItem(this.storageKey);
    if (!raw) return [];
    try {
      const decoded: unknown = JSON.parse(raw);
      if (!Array.isArray(decoded)) throw new Error('not an array');
      return decoded.filter(
        (i): i is PendingIntent =>
          !!i &&
          typeof i === 'object' &&
          ((i as PendingIntent).kind === 'registration' ||
            (i as PendingIntent).kind === 'claim') &&
          typeof (i as PendingIntent).dayKey === 'string' &&
          typeof (i as PendingIntent).createdAtMs === 'number'
      );
    } catch {
      // Corrupt value — drop it rather than crash forever.
      this.options.store.removeItem(this.storageKey);
      return [];
    }
  }

  private saveIntents(intents: PendingIntent[]): void {
    try {
      if (intents.length === 0) {
        this.options.store.removeItem(this.storageKey);
      } else {
        this.options.store.setItem(this.storageKey, JSON.stringify(intents));
      }
    } catch (error) {
      logger.debug('Offline retry queue persistence failed:', error);
    }
  }

  /**
   * SAME-DAY GUARD: drops any intent whose local calendar day has ended.
   * The server would re-window a stale claim into the new day anyway
   * (server-authoritative day windows — governed anti-fraud contract), and
   * initiating a NEW day's claim is the auto-open engine's job, not ours.
   */
  private prune(): PendingIntent[] {
    const today = this.dayKey;
    const intents = this.loadIntents();
    const fresh = intents.filter((i) => i.dayKey === today);
    if (fresh.length !== intents.length) {
      logger.info(
        `Offline retry: dropped ${intents.length - fresh.length} stale (previous-day) intent(s)`
      );
      this.saveIntents(fresh);
    }
    return fresh;
  }
}

// ─── Offline analytics buffering ───

/**
 * One buffered publisher-facing analytics event, with its ORIGINAL timestamp
 * so a flush after reconnect doesn't shift the publisher's timeline.
 */
interface BufferedAnalyticsEvent {
  event: string;
  properties?: Record<string, unknown>;
  timestampMs: number;
}

/**
 * Wraps the publisher's {@link AnalyticsAdapter}. While offline
 * (`navigator.onLine === false`; unknown counts as online), `track` emissions
 * land in a bounded, persisted ring buffer (capacity 100 — oldest dropped
 * first) and are replayed in order on the `online` event / next load, each
 * carrying `original_timestamp` (ISO-8601) and `original_timestamp_ms`.
 * `identify` passes through unbuffered (state, not an event).
 */
export class BufferingAnalyticsAdapter implements AnalyticsAdapter {
  public static readonly capacity = 100;

  private readonly storageKey: string;

  constructor(
    private readonly options: {
      inner: AnalyticsAdapter;
      store: OfflineStateStore;
      bundleId: string;
      isOnline?: () => boolean;
      now?: () => number;
    }
  ) {
    this.storageKey = `${AVAFLI_CONSTANTS.STORAGE_KEYS.OFFLINE_ANALYTICS_BUFFER}_${options.bundleId}`;
  }

  /** The wrapped publisher adapter (identity checks at wiring time). */
  public get inner(): AnalyticsAdapter {
    return this.options.inner;
  }

  private isOnline(): boolean {
    if (this.options.isOnline) return this.options.isOnline();
    // Assume online when the platform can't say (SSR, old browsers).
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  public track(event: string, properties?: Record<string, unknown>): void {
    if (this.isOnline()) {
      // Preserve ordering: anything buffered from an offline stretch flushes
      // BEFORE the live event goes through.
      this.flush();
      this.options.inner.track(event, properties);
    } else {
      this.buffer(event, properties);
    }
  }

  public identify(userId: string, traits?: Record<string, unknown>): void {
    this.options.inner.identify(userId, traits);
  }

  /**
   * Replays the buffered events to the wrapped adapter, oldest first.
   * Called on the `online` event, on load, and before any live event.
   */
  public flush(): void {
    const events = this.loadBuffer();
    if (events.length === 0) return;
    this.options.store.removeItem(this.storageKey);
    for (const buffered of events) {
      this.options.inner.track(buffered.event, {
        ...buffered.properties,
        original_timestamp: new Date(buffered.timestampMs).toISOString(),
        original_timestamp_ms: buffered.timestampMs,
      });
    }
    logger.debug(`Flushed ${events.length} buffered offline analytics event(s)`);
  }

  /** Flush only when the platform says the network is back. */
  public flushIfOnline(): void {
    if (this.isOnline()) this.flush();
  }

  public get bufferedCount(): number {
    return this.loadBuffer().length;
  }

  private buffer(event: string, properties?: Record<string, unknown>): void {
    let events = this.loadBuffer();
    events.push({
      event,
      ...(properties ? { properties } : {}),
      timestampMs: this.options.now?.() ?? Date.now(),
    });
    // Bounded ring buffer — drop oldest beyond capacity. HARD cap.
    if (events.length > BufferingAnalyticsAdapter.capacity) {
      events = events.slice(events.length - BufferingAnalyticsAdapter.capacity);
    }
    try {
      this.options.store.setItem(this.storageKey, JSON.stringify(events));
    } catch (error) {
      logger.debug('Offline analytics buffer persistence failed:', error);
    }
  }

  private loadBuffer(): BufferedAnalyticsEvent[] {
    const raw = this.options.store.getItem(this.storageKey);
    if (!raw) return [];
    try {
      const decoded: unknown = JSON.parse(raw);
      if (!Array.isArray(decoded)) throw new Error('not an array');
      return decoded.filter(
        (e): e is BufferedAnalyticsEvent =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as BufferedAnalyticsEvent).event === 'string' &&
          typeof (e as BufferedAnalyticsEvent).timestampMs === 'number'
      );
    } catch {
      this.options.store.removeItem(this.storageKey);
      return [];
    }
  }
}

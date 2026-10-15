import { AvafliError, AvafliErrorCode, AvafliErrorDetails, Logger } from '../types';

/**
 * 3.2.2 (RESILIENCE_SPEC): bounded retry for infrastructure refusals.
 *
 * When a traffic step outruns warm Cloud Run instances the platform answers
 * at once with HTTP 429 or 500 and a plain-text body ("The request was
 * aborted because there was no available instance."). Instances arrive
 * within ~10–30 s. Base delays 1 s, 2 s, 4 s, 8 s (four retries, ≈15 s worst
 * case), each `random(0, base) + 250 ms` (full jitter). A `Retry-After`
 * header (seconds) is honoured instead, capped at 10 s.
 */
const INFRA_RETRY_BASE_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];
const RETRY_JITTER_FLOOR_MS = 250;
const RETRY_AFTER_CAP_MS = 10000;
const INFRA_REFUSAL_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** Internal tag — never a public field on AvafliError. */
interface InfraRefusalTag {
  retryAfterMs?: number;
}
const infraRefusals = new WeakMap<AvafliError, InfraRefusalTag>();

/**
 * A Firebase callable (onCall) error body: `{"error":{"message","status",…}}`.
 * Anything else — plain text, HTML, empty, or JSON of another shape — is the
 * platform speaking, not our function.
 */
function isCallableErrorBody(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const error = (parsed as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const { message, status } = error as { message?: unknown; status?: unknown };
  return typeof message === 'string' || typeof status === 'string';
}

/**
 * Infra refusal = 429/500/502/503/504 AND the body is NOT a callable error.
 * A callable-bodied 429 ("Too many requests…", RESOURCE_EXHAUSTED) is our own
 * rate limiter and is surfaced at once.
 */
export function isInfraRefusal(status: number, callableBody: boolean): boolean {
  return INFRA_REFUSAL_STATUSES.has(status) && !callableBody;
}

/** `Retry-After` in whole seconds → ms, capped. Non-numeric (HTTP-date) is ignored. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

/**
 * HTTP client with automatic token refresh and retry logic
 */
export class NetworkClient {
  private baseURL: string;
  private apiKey: string;
  /**
   * 3.1.11: may be async — the SDK's provider refreshes an expired token
   * BEFORE the request goes out instead of eating a guaranteed 401.
   */
  private tokenProvider?: () => string | null | Promise<string | null>;
  private refreshHandler?: () => Promise<string | null>;
  private logger?: Logger;
  /** Injectable so tests drive the backoff with fake timers. */
  private sleepFn: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0, 1). */
  private randomFn: () => number;

  constructor(options: {
    baseURL: string;
    apiKey: string;
    tokenProvider?: () => string | null | Promise<string | null>;
    refreshHandler?: () => Promise<string | null>;
    logger?: Logger;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  }) {
    this.baseURL = options.baseURL.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = options.apiKey;
    this.tokenProvider = options.tokenProvider;
    this.refreshHandler = options.refreshHandler;
    this.logger = options.logger;
    this.sleepFn = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.randomFn = options.random ?? Math.random;
  }

  /**
   * Send HTTP request with automatic retry and token refresh
   */
  public async request<T = unknown>(
    endpoint: string,
    options: RequestInit & {
      timeout?: number;
      retries?: number;
      requiresAuth?: boolean;
    } = {}
  ): Promise<T> {
    const {
      timeout = 10000,
      retries = 3,
      requiresAuth = true,
      ...fetchOptions
    } = options;

    const url = `${this.baseURL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    
    let lastError: Error | null = null;
    let attempts = 0;

    for (let attempt = 0; ; attempt++) {
      attempts = attempt + 1;
      try {
        const headers = new Headers(fetchOptions.headers);
        // The backend functions are Firebase callable (onCall): POST + JSON only.
        headers.set('content-type', 'application/json');

        // Authentication: onCall reads the Firebase ID token from the Authorization
        // bearer to populate request.auth. No x-api-key header — onCall doesn't use it
        // and a non-allowlisted custom header trips CORS. The publisher apiKey travels
        // inside the request payload (e.g. registerDevice), not a header.
        if (requiresAuth && this.tokenProvider) {
          const token = await this.tokenProvider();
          if (token) {
            headers.set('authorization', `Bearer ${token}`);
          }
        }

        // Wrap the payload in the callable envelope: { data: ... }.
        const rawBody = typeof fetchOptions.body === 'string' ? fetchOptions.body : undefined;
        const payload = rawBody ? JSON.parse(rawBody) : {};

        this.logger?.debug(`Making request to ${url}`);

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            ...fetchOptions,
            method: 'POST', // onCall endpoints are POST-only
            headers,
            body: JSON.stringify({ data: payload }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Handle 401 Unauthorized - attempt token refresh
          if (response.status === 401 && this.refreshHandler && attempt === 0) {
            this.logger?.debug('Received 401, attempting token refresh');
            
            try {
              const newToken = await this.refreshHandler();
              if (newToken) {
                this.logger?.debug('Token refresh successful, retrying request');
                // Retry with new token (this will be attempt 1)
                continue;
              }
            } catch (refreshError) {
              this.logger?.error('Token refresh failed:', refreshError);
              throw new AvafliError(
                AvafliErrorCode.AuthenticationRequired,
                'Authentication failed and token refresh unsuccessful',
                refreshError instanceof Error ? refreshError : undefined
              );
            }
          }

          // Check for other HTTP errors
          if (!response.ok) {
            let errorMessage = `HTTP ${response.status}`;
            let errorBody: unknown;

            let errorDetails: AvafliErrorDetails | undefined;
            // App error (callable JSON body) vs infra refusal (platform text/HTML/empty).
            let callableBody = false;

            try {
              errorBody = await response.text();
              const parsed = JSON.parse(errorBody as string) as { error?: { message?: string; details?: unknown } | string; message?: string };
              callableBody = isCallableErrorBody(parsed);
              // onCall errors come back as { error: { message, status } }.
              errorMessage = (typeof parsed.error === "object" ? parsed.error?.message : parsed.error) || parsed.message || errorMessage;
              // 3.2.0: keep the callable's `details` (machine-readable reason
              // + fields) for the flows that branch on it.
              const details = typeof parsed.error === "object" ? parsed.error?.details : undefined;
              if (details && typeof details === 'object' && !Array.isArray(details)) {
                errorDetails = details as AvafliErrorDetails;
              }
            } catch {
              // Use raw text or default message
              errorMessage = (typeof errorBody === 'string' ? errorBody : '') || errorMessage;
            }

            const httpErr = new AvafliError(
              this.mapErrorToCode(response.status, errorMessage),
              errorMessage
            );
            // Tag the status so the retry loop (and the offline retry queue)
            // can tell a real backend response — 4xx rejection OR 5xx — from
            // a transport failure that never completed.
            httpErr.httpStatus = response.status;
            if (errorDetails) httpErr.details = errorDetails;
            if (isInfraRefusal(response.status, callableBody)) {
              infraRefusals.set(httpErr, {
                retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
              });
            }
            throw httpErr;
          }

          // Parse response
          let result: T;
          const contentType = response.headers.get('content-type') || '';
          
          if (contentType.includes('application/json')) {
            const json = await response.json();
            // onCall wraps success payloads as { result: ... } — unwrap it.
            const unwrapped = (json && typeof json === 'object' && 'result' in (json as object))
              ? (json as { result: unknown }).result
              : json;
            result = unwrapped as T;
          } else {
            result = await response.text() as T;
          }

          this.logger?.debug(`Request successful: ${url}`);
          return result;

        } catch (error) {
          clearTimeout(timeoutId);
          
          if (error instanceof Error && error.name === 'AbortError') {
            throw new AvafliError(
              AvafliErrorCode.NetworkError,
              `Request timeout after ${timeout}ms`
            );
          }
          
          throw error;
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry for certain error types
        if (error instanceof AvafliError) {
          if (
            error.code === AvafliErrorCode.AuthenticationRequired ||
            // A suspended/revoked publisher is a terminal state — retrying with
            // backoff just delays surfacing the service-unavailable error.
            error.code === AvafliErrorCode.ServiceUnavailable
          ) {
            throw error;
          }
        }

        const infra = error instanceof AvafliError ? infraRefusals.get(error) : undefined;
        const httpStatus = (error as { httpStatus?: number }).httpStatus;

        // App errors — the function answered with a callable error body — are
        // NOT retryable, whatever the status: a 4xx would only be rejected
        // again and masking the real message ("You've already entered today",
        // consent required, geo, validation, our own rate limiter) as a
        // generic "Request failed after N attempts" helps nobody. Surface the
        // real error immediately. Only transient failures fall through:
        // transport/timeout (no status) and infra refusals (429/5xx with a
        // non-callable body — the platform had no instance to run us).
        if (typeof httpStatus === 'number' && !infra) {
          throw error;
        }

        // Retry budget: infra refusals get the spec's four retries; transport
        // failures keep the caller's `retries` (default 3 attempts).
        const maxRetries = infra ? INFRA_RETRY_BASE_DELAYS_MS.length : retries - 1;
        if (attempt >= maxRetries) {
          break;
        }

        const delay = this.retryDelayMs(attempt, infra?.retryAfterMs);
        if (infra) {
          this.logger?.debug(
            `Infrastructure refusal (HTTP ${httpStatus}), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`
          );
        } else {
          this.logger?.debug(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        }
        await this.sleepFn(delay);
      }
    }

    // If we get here, all retries failed
    const exhausted = new AvafliError(
      AvafliErrorCode.NetworkError,
      `Request failed after ${attempts} attempts`,
      lastError ?? undefined
    );
    // Propagate the last HTTP status (a retried-out infra refusal) so the
    // ABSENCE of httpStatus on this wrapper reliably means "the request never
    // completed" — the transport-only signal the offline retry queue needs.
    // An exhausted infra refusal is therefore NOT queued: the server
    // answered, it was just busy.
    const lastStatus = (lastError as { httpStatus?: number } | null)?.httpStatus;
    if (typeof lastStatus === 'number') {
      exhausted.httpStatus = lastStatus;
    }
    // Same for the callable's details — a retried-out error keeps its reason.
    const lastDetails = (lastError as { details?: AvafliErrorDetails } | null)?.details;
    if (lastDetails) {
      exhausted.details = lastDetails;
    }
    throw exhausted;
  }

  /**
   * Delay before retry `attempt` (0-based). `Retry-After` wins when the server
   * sent one (already capped at 10 s); otherwise full jitter over the base
   * schedule. The 250 ms floor applies to both.
   */
  private retryDelayMs(attempt: number, retryAfterMs?: number): number {
    if (typeof retryAfterMs === 'number') {
      return Math.max(RETRY_JITTER_FLOOR_MS, retryAfterMs);
    }
    const last = INFRA_RETRY_BASE_DELAYS_MS.length - 1;
    const base = INFRA_RETRY_BASE_DELAYS_MS[Math.min(attempt, last)] ?? INFRA_RETRY_BASE_DELAYS_MS[last] ?? 8000;
    return Math.floor(this.randomFn() * base) + RETRY_JITTER_FLOOR_MS;
  }

  /**
   * GET request
   */
  public async get<T = unknown>(
    endpoint: string,
    options?: Omit<RequestInit, 'method' | 'body'> & {
      timeout?: number;
      retries?: number;
      requiresAuth?: boolean;
    }
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  public async post<T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: Omit<RequestInit, 'method' | 'body'> & {
      timeout?: number;
      retries?: number;
      requiresAuth?: boolean;
    }
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  public async put<T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: Omit<RequestInit, 'method' | 'body'> & {
      timeout?: number;
      retries?: number;
      requiresAuth?: boolean;
    }
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  public async delete<T = unknown>(
    endpoint: string,
    options?: Omit<RequestInit, 'method' | 'body'> & {
      timeout?: number;
      retries?: number;
      requiresAuth?: boolean;
    }
  ): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Map an HTTP error response to a AvafliErrorCode. A "suspended"/"revoked"
   * message (publisher billing lapse) is mapped to ServiceUnavailable
   * regardless of status so the SDK can degrade gracefully; otherwise fall
   * back to the status-based mapping.
   */
  private mapErrorToCode(status: number, message: string): AvafliErrorCode {
    if (/suspend|revok/i.test(message)) {
      return AvafliErrorCode.ServiceUnavailable;
    }
    return this.mapHttpStatusToErrorCode(status);
  }

  private mapHttpStatusToErrorCode(status: number): AvafliErrorCode {
    switch (status) {
      case 401:
        return AvafliErrorCode.AuthenticationRequired;
      case 400:
        return AvafliErrorCode.InvalidState;
      case 404:
        return AvafliErrorCode.GiveawayNotActive;
      default:
        return AvafliErrorCode.NetworkError;
    }
  }
}

/**
 * Factory function to create a network client
 */
export function createNetworkClient(options: {
  baseURL: string;
  apiKey: string;
  tokenProvider?: () => string | null | Promise<string | null>;
  refreshHandler?: () => Promise<string | null>;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): NetworkClient {
  return new NetworkClient(options);
}

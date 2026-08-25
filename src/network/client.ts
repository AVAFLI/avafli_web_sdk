import { AvafliError, AvafliErrorCode, Logger } from '../types';

/**
 * HTTP client with automatic token refresh and retry logic
 */
export class NetworkClient {
  private baseURL: string;
  private apiKey: string;
  private tokenProvider?: () => string | null;
  private refreshHandler?: () => Promise<string | null>;
  private logger?: Logger;

  constructor(options: {
    baseURL: string;
    apiKey: string;
    tokenProvider?: () => string | null;
    refreshHandler?: () => Promise<string | null>;
    logger?: Logger;
  }) {
    this.baseURL = options.baseURL.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = options.apiKey;
    this.tokenProvider = options.tokenProvider;
    this.refreshHandler = options.refreshHandler;
    this.logger = options.logger;
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

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const headers = new Headers(fetchOptions.headers);
        // The backend functions are Firebase callable (onCall): POST + JSON only.
        headers.set('content-type', 'application/json');

        // Authentication: onCall reads the Firebase ID token from the Authorization
        // bearer to populate request.auth. No x-api-key header — onCall doesn't use it
        // and a non-allowlisted custom header trips CORS. The publisher apiKey travels
        // inside the request payload (e.g. registerDevice), not a header.
        if (requiresAuth && this.tokenProvider) {
          const token = this.tokenProvider();
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

            try {
              errorBody = await response.text();
              const parsed = JSON.parse(errorBody as string) as { error?: { message?: string } | string; message?: string };
              // onCall errors come back as { error: { message, status } }.
              errorMessage = (typeof parsed.error === "object" ? parsed.error?.message : parsed.error) || parsed.message || errorMessage;
            } catch {
              // Use raw text or default message
              errorMessage = (typeof errorBody === 'string' ? errorBody : '') || errorMessage;
            }

            const httpErr = new AvafliError(
              this.mapErrorToCode(response.status, errorMessage),
              errorMessage
            );
            // Tag the status so the retry loop can tell a definitive client error
            // (4xx — already-claimed, consent, geo, validation) from a transient one.
            (httpErr as unknown as { httpStatus: number }).httpStatus = response.status;
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

        // Definitive client errors (4xx) are NOT retryable — retrying just masks the
        // real backend message ("You've already entered today", consent required,
        // geo, validation) as a generic "Request failed after N attempts". Surface
        // the real error immediately. Only transient failures (network/timeout/5xx)
        // fall through to the retry/backoff below.
        const httpStatus = (error as { httpStatus?: number }).httpStatus;
        if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
          throw error;
        }

        // Log retry attempts
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          this.logger?.debug(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
          await this.sleep(delay);
        }
      }
    }

    // If we get here, all retries failed
    throw new AvafliError(
      AvafliErrorCode.NetworkError,
      `Request failed after ${retries} attempts`,
      lastError ?? undefined
    );
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create a network client
 */
export function createNetworkClient(options: {
  baseURL: string;
  apiKey: string;
  tokenProvider?: () => string | null;
  refreshHandler?: () => Promise<string | null>;
  logger?: Logger;
}): NetworkClient {
  return new NetworkClient(options);
}
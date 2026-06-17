import {
  WINRConfiguration,
  WINRUser,
  WINRError,
  WINRErrorCode,
  PresentationOptions,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  GetActiveGiveawayResponse,
  ClaimDailyEntriesResponse,
  SubmitEmailRequest,
  SubmitUserProfileRequest,
  DeleteUserDataResponse,
  Giveaway,
  StreakState,
  SDKConfig,
  WINR_CONSTANTS,
} from './types';
import { NetworkClient } from './network/client';
import { WINRAPI, createWINRAPI } from './network/api';
import { WINRModal } from './ui/winr-modal';
import { StreakEngine } from './domain/streak-engine';
import { LocalStorageProvider } from './storage/local-storage';
import { SessionStorageProvider } from './storage/session-storage';
import { logger } from './services/logger';
import { analyticsAdapter } from './services/analytics';

/** UUID v4 validation regex (per Master Field List: user_uid). */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Name validation regex (first_name / last_name per spec). */
const NAME_REGEX = /^[a-zA-Z '-]{1,50}$/;

/** US 10-digit phone regex (applied after stripping non-digits). */
const PHONE_REGEX = /^\+?1?\d{10}$/;

/**
 * Validate a JWT's structure and expiry without verifying the signature.
 * Signature verification happens server-side; the SDK only needs to know
 * whether the token is well-formed and still valid so it can proactively
 * refresh rather than wait for a 401.
 */
function isJwtValid(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payloadPart = parts[1];
  if (!payloadPart) return false;
  try {
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const payloadJson =
      typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('utf-8');
    const payload = JSON.parse(payloadJson) as { exp?: number };
    if (typeof payload.exp === 'number') {
      // exp is seconds since epoch; treat as expired with a small skew buffer.
      if (Date.now() >= payload.exp * 1000 - 5000) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Main WINR Web SDK class
 * Singleton pattern for global access
 */
export class WINR {
  private static instance: WINR | null = null;
  private static isConfigured = false;
  /**
   * Cached service-unavailable error captured during a failed configure() when
   * the publisher is suspended/revoked. Held at the static level because a
   * failed configure() tears down the instance — custom-UI publishers still
   * need to query {@link WINR.isAvailable}/{@link WINR.unavailableReason}.
   */
  private static serviceUnavailable: WINRError | null = null;

  private client: NetworkClient;
  private api: WINRAPI;
  private config: WINRConfiguration;
  private currentUser: WINRUser | null = null;
  private currentGiveaway: Giveaway | null = null;
  private streakEngine: StreakEngine;
  /**
   * Non-sensitive preferences (device fingerprint, cached giveaway, streak
   * state, last claim date). Persisted in localStorage.
   */
  private storage: LocalStorageProvider;
  /**
   * Sensitive auth material (session_token, refresh token, user_uid).
   *
   * SECURITY: These are stored in sessionStorage rather than localStorage to
   * limit persistence and exposure window. The ideal is httpOnly cookies set
   * by the backend (not readable by JS, immune to XSS token theft); production
   * deployments SHOULD prefer that. Within the SDK's control, sessionStorage is
   * the least-persistent option available and is self-documented for secrets.
   */
  private secureStorage: SessionStorageProvider;
  private deviceFingerprint: string | null = null;
  private currentModal: WINRModal | null = null;
  private serverSDKConfig: SDKConfig | null = null;
  /**
   * Cached "publisher suspended / service unavailable" state. Set when device
   * registration fails because the publisher's API key has been suspended or
   * revoked (billing lapse). Once set, present/presentInline short-circuit
   * without rendering the modal, and {@link WINR.isAvailable} reports false.
   */
  private serviceUnavailableError: WINRError | null = null;

  private constructor(config: WINRConfiguration) {
    this.config = config;
    this.storage = new LocalStorageProvider();
    this.secureStorage = new SessionStorageProvider();
    this.streakEngine = new StreakEngine();

    // Initialize network client
    this.client = new NetworkClient({
      baseURL: WINR_CONSTANTS.getApiBaseUrl(config.options?.environment),
      apiKey: config.apiKey,
      tokenProvider: () => this.getValidToken(),
      refreshHandler: () => this.refreshToken(),
      logger: logger,
    });
    this.api = createWINRAPI(this.client);
  }

  /**
   * Internal accessor for the authed, typed API client bound to the singleton.
   * Used by UI components so they route through the authenticated network
   * client instead of constructing their own unauthenticated one.
   */
  public static getAPI(): WINRAPI {
    WINR.ensureConfigured();
    return WINR.instance!.api;
  }

  /** Expose the resolved consent / age-gate config to UI components. */
  public static getResolvedSDKConfig(): SDKConfig {
    WINR.ensureConfigured();
    return WINR.instance!.getCurrentSDKConfig();
  }

  /**
   * Whether the WINR experience is currently available for this publisher.
   *
   * Returns false when the SDK has not been configured, or when device
   * registration determined the publisher's account/API key is suspended or
   * revoked. Publishers embedding their own (custom) UI can poll this to decide
   * whether to render the WINR entry point or show their own "no longer
   * available" message instead of calling {@link WINR.present}.
   */
  public static get isAvailable(): boolean {
    if (WINR.serviceUnavailable) return false;
    if (!WINR.isConfigured || !WINR.instance) return false;
    return WINR.instance.serviceUnavailableError === null;
  }

  /**
   * The service-unavailable error, if the publisher has been suspended/revoked,
   * otherwise null. Lets custom-UI publishers read the message/code without
   * triggering an exception. Returns null until the SDK is configured.
   */
  public static get unavailableReason(): WINRError | null {
    if (WINR.serviceUnavailable) return WINR.serviceUnavailable;
    if (!WINR.isConfigured || !WINR.instance) return null;
    return WINR.instance.serviceUnavailableError;
  }

  /**
   * Detect whether an error from the backend indicates the publisher's account
   * has been suspended or revoked. The backend surfaces these as messages
   * containing "suspended" (e.g. "API key suspended or revoked",
   * "Publisher account suspended").
   */
  private static isSuspendedError(error: unknown): boolean {
    if (error instanceof WINRError && error.code === WINRErrorCode.ServiceUnavailable) {
      return true;
    }
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return /suspend|revok/i.test(message);
  }

  /**
   * Return the stored session token, proactively refreshing it if it is
   * structurally invalid or expired. The network client previously only
   * reacted to a 401; this validates `exp` up front.
   */
  private getValidToken(): string | null {
    const token = this.secureStorage.getItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN);
    if (token && isJwtValid(token)) {
      return token;
    }
    // Token missing/expired/malformed — kick off a refresh (best-effort, async)
    // and return the current value so the in-flight request can still attempt;
    // a resulting 401 will trigger the reactive refresh path as a fallback.
    if (this.secureStorage.getItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN)) {
      this.refreshToken().catch((err) =>
        logger.debug('Proactive token refresh failed:', err)
      );
    }
    return token;
  }

  /**
   * Configure the WINR SDK
   */
  public static async configure(config: WINRConfiguration): Promise<void> {
    if (WINR.isConfigured) {
      logger.warn('WINR already configured, skipping reconfiguration');
      return;
    }

    // Clear any service-unavailable state from a prior failed attempt so this
    // configure() starts clean.
    WINR.serviceUnavailable = null;

    try {
      // Validate configuration
      if (!config.apiKey || !config.bundleId) {
        throw new WINRError(
          WINRErrorCode.InvalidConfiguration,
          'API key and bundle ID are required'
        );
      }

      if (!config.user || !config.user.id || !config.user.firstName || !config.user.lastName) {
        throw new WINRError(
          WINRErrorCode.InvalidConfiguration,
          'User with id, firstName, and lastName is required'
        );
      }

      // Validate name characters/length (first_name / last_name per spec).
      if (!NAME_REGEX.test(config.user.firstName) || !NAME_REGEX.test(config.user.lastName)) {
        throw new WINRError(
          WINRErrorCode.InvalidConfiguration,
          'First and last name may only contain letters, spaces, hyphens, or apostrophes (max 50 chars)'
        );
      }

      // Validate phone (optional). Strip non-digits, then check US 10-digit format.
      if (config.user.phone) {
        const normalizedPhone = config.user.phone.replace(/\D/g, '');
        if (!PHONE_REGEX.test(normalizedPhone)) {
          throw new WINRError(
            WINRErrorCode.InvalidConfiguration,
            'Please enter a valid 10-digit mobile number'
          );
        }
        config.user.phone = normalizedPhone;
      }

      // Create singleton instance
      WINR.instance = new WINR(config);
      
      // Initialize device fingerprint
      await WINR.instance.initializeDeviceFingerprint();
      
      // Register device
      await WINR.instance.registerDevice();
      
      WINR.isConfigured = true;
      logger.info('WINR SDK configured successfully');
      
      // Initialize analytics if provided
      if (config.options?.analyticsAdapter) {
        analyticsAdapter.setAdapter(config.options.analyticsAdapter);
      }

      // Auto-setup user from configuration
      const user = config.user;
      WINR.instance.currentUser = user;

      // Submit user profile to server
      try {
        await WINR.instance.client.post<{ success: boolean }>('/submitUserProfile', {
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          smsConsent: false,
          publisherUserId: user.id,
        } as SubmitUserProfileRequest);
      } catch (profileError) {
        logger.warn('Failed to submit user profile:', profileError);
        // Non-fatal — continue
      }

      // Identify user in analytics
      analyticsAdapter.identify(user.id, {
        firstName: user.firstName,
        lastName: user.lastName,
      });

      logger.debug('User set from configuration:', { userId: user.id });

    } catch (error) {
      WINR.instance = null;
      WINR.isConfigured = false;

      // Preserve a service-unavailable (publisher suspended) error verbatim and
      // cache it at the static level so isAvailable / unavailableReason still
      // report it after the instance is torn down. Detect both the typed error
      // (thrown from registerDevice) and any raw suspended message.
      if (
        (error instanceof WINRError && error.code === WINRErrorCode.ServiceUnavailable) ||
        WINR.isSuspendedError(error)
      ) {
        const winrError =
          error instanceof WINRError && error.code === WINRErrorCode.ServiceUnavailable
            ? error
            : new WINRError(
                WINRErrorCode.ServiceUnavailable,
                'WINR is no longer available',
                error instanceof Error ? error : undefined
              );
        WINR.serviceUnavailable = winrError;
        logger.warn('WINR configuration failed — publisher account suspended or revoked');
        throw winrError;
      }

      const winrError = error instanceof WINRError
        ? error
        : new WINRError(
            WINRErrorCode.InvalidConfiguration,
            'Failed to configure WINR SDK',
            error instanceof Error ? error : undefined
          );

      logger.error('WINR configuration failed:', winrError);
      throw winrError;
    }
  }

  /**
   * Present the WINR experience as a modal
   */
  public static async present(options?: PresentationOptions): Promise<void> {
    // If the publisher has been suspended, do NOT render the modal. Surface the
    // cached service-unavailable error via the onError callback + rejection so a
    // half-rendered modal is never left on screen. Checked before
    // ensureConfigured() because a suspended configure() tears down the instance.
    const unavailable = WINR.unavailableReason;
    if (unavailable) {
      logger.warn('present() called while WINR is unavailable — not rendering modal');
      options?.onError?.(unavailable);
      throw unavailable;
    }

    if (!WINR.ensureConfigured()) return;

    try {
      // Refresh SDK config to ensure latest branding/settings
      await WINR.instance!.refreshConfig();
      
      // Refresh giveaway data
      await WINR.instance!.refreshGiveawayData();
      
      // Get current streak state
      const streakState = WINR.instance!.getStreakState();
      
      // Create and present modal
      WINR.instance!.currentModal = new WINRModal(
        WINR.instance!.currentGiveaway,
        streakState,
        WINR.instance!.getCurrentSDKConfig(),
        options,
        false, // claimedToday
        false, // hasEmail
        WINR.instance!.config.user.id
      );
      
      // Track modal presentation
      analyticsAdapter.track('winr_modal_presented', {
        giveawayId: WINR.instance!.currentGiveaway?.id,
        streakDay: streakState?.currentDay || 0,
      });
      
      await WINR.instance!.currentModal.present();
      
    } catch (error) {
      const winrError = error instanceof WINRError 
        ? error 
        : new WINRError(
            WINRErrorCode.InvalidState,
            'Failed to present WINR modal',
            error instanceof Error ? error : undefined
          );
      
      logger.error('Failed to present modal:', winrError);
      options?.onError?.(winrError);
      throw winrError;
    }
  }

  /**
   * Present the WINR experience inline in a container
   */
  public static async presentInline(
    containerId: string, 
    options?: PresentationOptions
  ): Promise<void> {
    // If the publisher has been suspended, do NOT render the inline experience.
    const unavailable = WINR.unavailableReason;
    if (unavailable) {
      logger.warn('presentInline() called while WINR is unavailable — not rendering modal');
      options?.onError?.(unavailable);
      throw unavailable;
    }

    if (!WINR.ensureConfigured()) return;

    try {
      // Refresh SDK config to ensure latest branding/settings
      await WINR.instance!.refreshConfig();

      // Refresh giveaway data
      await WINR.instance!.refreshGiveawayData();

      // Get current streak state
      const streakState = WINR.instance!.getStreakState();

      // Create and present inline modal
      WINR.instance!.currentModal = new WINRModal(
        WINR.instance!.currentGiveaway,
        streakState,
        WINR.instance!.getCurrentSDKConfig(),
        options,
        false, // claimedToday
        false, // hasEmail
        WINR.instance!.config.user.id
      );
      
      // Track inline presentation
      analyticsAdapter.track('winr_inline_presented', {
        giveawayId: WINR.instance!.currentGiveaway?.id,
        streakDay: streakState?.currentDay || 0,
        containerId,
      });
      
      await WINR.instance!.currentModal.presentInline(containerId);
      
    } catch (error) {
      const winrError = error instanceof WINRError 
        ? error 
        : new WINRError(
            WINRErrorCode.InvalidState,
            'Failed to present WINR inline',
            error instanceof Error ? error : undefined
          );
      
      logger.error('Failed to present inline:', winrError);
      options?.onError?.(winrError);
      throw winrError;
    }
  }

  /**
   * Dismiss any currently presented modal
   */
  public static dismiss(): void {
    if (!WINR.ensureConfigured()) return;
    
    if (WINR.instance!.currentModal) {
      WINR.instance!.currentModal.dismiss();
      WINR.instance!.currentModal = null;
      
      analyticsAdapter.track('winr_modal_dismissed');
      logger.debug('Modal dismissed');
    }
  }

  /**
   * Refresh SDK configuration from server
   */
  public static async refreshConfig(): Promise<void> {
    if (!WINR.ensureConfigured()) return;
    
    try {
      await WINR.instance!.refreshConfig();
      logger.info('SDK config refreshed successfully');
    } catch (error) {
      const winrError = error instanceof WINRError 
        ? error 
        : new WINRError(
            WINRErrorCode.NetworkError,
            'Failed to refresh SDK config',
            error instanceof Error ? error : undefined
          );
      
      logger.error('Failed to refresh config:', winrError);
      throw winrError;
    }
  }

  /**
   * Delete all user data (GDPR compliance)
   */
  public static async deleteUserData(): Promise<void> {
    if (!WINR.ensureConfigured()) return;
    
    try {
      // Call API to delete server-side data
      await WINR.instance!.client.delete<DeleteUserDataResponse>('/deleteUserData');
      
      // Clear local + session (sensitive) storage
      WINR.instance!.storage.clear();
      WINR.instance!.secureStorage.clear();
      
      // Reset internal state
      WINR.instance!.currentUser = null;
      WINR.instance!.currentGiveaway = null;
      WINR.instance!.deviceFingerprint = null;
      
      analyticsAdapter.track('winr_user_data_deleted');
      logger.info('User data deleted successfully');
      
    } catch (error) {
      const winrError = error instanceof WINRError 
        ? error 
        : new WINRError(
            WINRErrorCode.NetworkError,
            'Failed to delete user data',
            error instanceof Error ? error : undefined
          );
      
      logger.error('Failed to delete user data:', winrError);
      throw winrError;
    }
  }

  /**
   * Register for push notifications
   */
  public static async registerForPushNotifications(): Promise<void> {
    if (!WINR.ensureConfigured()) return;
    
    try {
      if (!('Notification' in window)) {
        throw new WINRError(
          WINRErrorCode.InvalidState,
          'Push notifications are not supported in this browser'
        );
      }

      if (Notification.permission === 'denied') {
        throw new WINRError(
          WINRErrorCode.InvalidState,
          'Push notifications are denied'
        );
      }

      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new WINRError(
            WINRErrorCode.InvalidState,
            'Push notification permission not granted'
          );
        }
      }

      analyticsAdapter.track('winr_push_notifications_enabled');
      logger.info('Push notifications enabled');
      
    } catch (error) {
      const winrError = error instanceof WINRError 
        ? error 
        : new WINRError(
            WINRErrorCode.InvalidState,
            'Failed to register for push notifications',
            error instanceof Error ? error : undefined
          );
      
      logger.error('Push notification registration failed:', winrError);
      throw winrError;
    }
  }

  // ─── Private Methods ───

  private static ensureConfigured(): boolean {
    if (!WINR.isConfigured || !WINR.instance) {
      logger.error('WINR not configured. Call WINR.configure() first.');
      throw new WINRError(
        WINRErrorCode.NotConfigured,
        'WINR SDK must be configured before use'
      );
    }
    return true;
  }

  private async initializeDeviceFingerprint(): Promise<void> {
    // Check if we have a cached fingerprint
    const cached = this.storage.getItem(WINR_CONSTANTS.STORAGE_KEYS.DEVICE_FINGERPRINT);
    if (cached) {
      this.deviceFingerprint = cached;
      return;
    }

    try {
      let fingerprint: string;
      
      // Use custom provider if available
      if (this.config.options?.deviceFingerprintProvider) {
        fingerprint = await this.config.options.deviceFingerprintProvider();
      } else {
        // Generate basic fingerprint
        fingerprint = await this.generateBasicFingerprint();
      }
      
      this.deviceFingerprint = fingerprint;
      this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.DEVICE_FINGERPRINT, fingerprint);
      
      logger.debug('Device fingerprint generated');
      
    } catch (error) {
      // Fallback to timestamp-based ID
      const fallback = `web_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      this.deviceFingerprint = fallback;
      this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.DEVICE_FINGERPRINT, fallback);
      
      logger.warn('Using fallback device fingerprint:', error);
    }
  }

  private async generateBasicFingerprint(): Promise<string> {
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ];
    
    const fingerprint = components.join('|');
    
    // Create a simple hash
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return `web_${Math.abs(hash).toString(36)}`;
  }

  private async registerDevice(): Promise<void> {
    if (!this.deviceFingerprint) {
      throw new WINRError(
        WINRErrorCode.InvalidState,
        'Device fingerprint not initialized'
      );
    }

    try {
      const request: RegisterDeviceRequest = {
        apiKey: this.config.apiKey,
        deviceFingerprint: this.deviceFingerprint,
        bundleId: this.config.bundleId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platformOS: WINR_CONSTANTS.PLATFORM_OS,
        sdkVersion: WINR_CONSTANTS.SDK_VERSION,
      };

      const response = await this.client.post<RegisterDeviceResponse>(
        '/registerDevice',
        request,
        { requiresAuth: false }
      );

      // Validate user_uid (UUID v4) returned from the handshake before storing.
      if (!response.uuid || !UUID_V4_REGEX.test(response.uuid)) {
        logger.error('registerDevice returned a malformed user_uid:', response.uuid);
        throw new WINRError(
          WINRErrorCode.InvalidState,
          'Device registration returned an invalid user identifier'
        );
      }

      // Store authentication tokens + uuid in sessionStorage (sensitive).
      this.secureStorage.setItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN, response.token);
      this.secureStorage.setItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);
      this.secureStorage.setItem(WINR_CONSTANTS.STORAGE_KEYS.UUID, response.uuid);

      // Store giveaway data and server SDK config
      if (response.giveaway === null) {
        // Clear cached giveaway data when no active giveaway
        this.currentGiveaway = null;
        this.storage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY);
      } else {
        // Store and cache the active giveaway
        this.currentGiveaway = response.giveaway;
        this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY, JSON.stringify(response.giveaway));
      }
      
      if (response.sdkConfig) {
        this.serverSDKConfig = response.sdkConfig;
      }

      // Initialize streak state if needed
      if (!response.isReturningUser) {
        const initialState: StreakState = {
          currentDay: response.streakDay,
          totalEntriesEarned: response.totalEntries,
          weeklyCurrent: 0,
          monthlyCurrent: 0,
        };
        this.setStreakState(initialState);
      }

      analyticsAdapter.track('winr_device_registered', {
        isReturningUser: response.isReturningUser,
        giveawayId: response.giveaway?.id,
      });

      logger.info('Device registered successfully', {
        isReturningUser: response.isReturningUser,
        giveawayId: response.giveaway?.id,
      });
      
    } catch (error) {
      // Publisher billing lapse: the backend rejects registration with a
      // "suspended"/"revoked" message. Cache this as a dedicated
      // service-unavailable state so repeat calls short-circuit and custom UI
      // can query WINR.isAvailable, then surface it as a typed WINRError.
      if (WINR.isSuspendedError(error)) {
        const winrError = new WINRError(
          WINRErrorCode.ServiceUnavailable,
          'WINR is no longer available',
          error instanceof Error ? error : undefined
        );
        this.serviceUnavailableError = winrError;
        logger.warn('WINR unavailable — publisher account suspended or revoked');
        throw winrError;
      }

      logger.error('Device registration failed:', error);
      throw error;
    }
  }

  private async refreshToken(): Promise<string | null> {
    const refreshToken = this.secureStorage.getItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      throw new WINRError(
        WINRErrorCode.AuthenticationRequired,
        'No refresh token available'
      );
    }

    try {
      const response = await this.client.post<{token: string, refreshToken: string}>('/refreshToken', 
        { refreshToken },
        { requiresAuth: false }
      );

      // Update stored tokens
      this.secureStorage.setItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN, response.token);
      this.secureStorage.setItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);

      logger.debug('Token refreshed successfully');
      return response.token;

    } catch (error) {
      logger.error('Token refresh failed:', error);
      // Clear invalid tokens
      this.secureStorage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN);
      this.secureStorage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN);
      throw error;
    }
  }

  private async refreshConfig(): Promise<void> {
    try {
      // Fetch fresh SDK config from getActiveGiveaway endpoint
      // This ensures the latest branding, copy, and settings are loaded
      const response = await this.client.get<GetActiveGiveawayResponse>('/getActiveGiveaway');
      if (response.sdkConfig) {
        this.serverSDKConfig = response.sdkConfig;
      }
      
      logger.debug('SDK config refreshed');
      
    } catch (error) {
      logger.warn('Failed to refresh SDK config:', error);
      // Continue with cached config
    }
  }

  private async refreshGiveawayData(): Promise<void> {
    try {
      const response = await this.client.get<GetActiveGiveawayResponse>('/getActiveGiveaway');
      
      if (response.giveaway === null) {
        // Clear cached giveaway data when no active giveaway
        this.currentGiveaway = null;
        this.storage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY);
        logger.debug('No active giveaway - cleared cached data');
      } else {
        // Store and cache the active giveaway
        this.currentGiveaway = response.giveaway;
        this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY, JSON.stringify(response.giveaway));
        logger.debug('Giveaway data refreshed');
      }
      
      if (response.sdkConfig) {
        this.serverSDKConfig = response.sdkConfig;
      }
      
    } catch (error) {
      logger.warn('Failed to refresh giveaway data:', error);
      // Try to load cached giveaway data if network fails
      const cachedGiveaway = this.storage.getItem(WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY);
      if (cachedGiveaway && !this.currentGiveaway) {
        try {
          this.currentGiveaway = JSON.parse(cachedGiveaway);
          logger.debug('Using cached giveaway data');
        } catch (parseError) {
          logger.warn('Failed to parse cached giveaway data:', parseError);
          this.storage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY);
        }
      }
    }
  }

  private getStreakState(): StreakState | null {
    const stored = this.storage.getItem(WINR_CONSTANTS.STORAGE_KEYS.STREAK_STATE);
    if (!stored) return null;
    
    try {
      const parsed = JSON.parse(stored);
      // Convert lastClaimedDate string back to Date
      if (parsed.lastClaimedDate) {
        parsed.lastClaimedDate = new Date(parsed.lastClaimedDate);
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private setStreakState(state: StreakState): void {
    this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.STREAK_STATE, JSON.stringify(state));
  }

  private getCurrentSDKConfig(): SDKConfig {
    // Merge client config with server-provided overrides (server wins)
    const serverBranding = this.serverSDKConfig?.branding;
    const clientBranding = this.config.branding;

    return {
      branding: {
        primaryColor: serverBranding?.primaryColor || clientBranding?.primaryColor,
        secondaryColor: serverBranding?.secondaryColor || clientBranding?.secondaryColor,
        backgroundColor: serverBranding?.backgroundColor || clientBranding?.backgroundColor,
        logoUrl: serverBranding?.logoUrl || clientBranding?.logoUrl,
        fontFamily: serverBranding?.fontFamily || clientBranding?.fontFamily,
      },
      copy: this.serverSDKConfig?.copy || {},
      rulesUrl: this.serverSDKConfig?.rulesUrl,
      ageGateEnabled: this.serverSDKConfig?.ageGateEnabled ?? this.config.options?.enableAgeGate ?? true,
      ageGateMinAge: this.serverSDKConfig?.ageGateMinAge ?? this.config.options?.ageGateMinAge ?? 18,
    };
  }
}
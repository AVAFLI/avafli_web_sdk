import {
  WINRConfiguration,
  WINRUser,
  WINRError,
  WINRErrorCode,
  PresentationOptions,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  GetActiveGiveawayResponse,
  SubmitEmailRequest,
  SubmitEmailResponse,
  SubmitUserProfileRequest,
  Giveaway,
  StreakState,
  SDKConfig,
  WINR_CONSTANTS,
} from './types';
import { NetworkClient } from './network/client';
import { WINRAPI, createWINRAPI } from './network/api';
import { WINRV2Experience } from './ui/v2/root';
import { V2ExperienceController, emailSubmittedStorageKey } from './ui/v2/controller';
import { prewarmImage } from './ui/v2/effects';
import { StreakEngine } from './domain/streak-engine';
import { LocalStorageProvider } from './storage/local-storage';
import { SessionStorageProvider } from './storage/session-storage';
import { logger } from './services/logger';
import { analyticsAdapter } from './services/analytics';

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
  // Authoritative per-user state from the backend (getActiveGiveaway). The modal
  // is gated on these so a recognized user isn't re-prompted for email and can't
  // re-claim after reopening — the web stores tokens in sessionStorage, so each
  // reopen re-registers, but registerDevice reuses the user by device fingerprint.
  private currentClaimedToday = false;
  private currentEmailConsentStatus = false;
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
  private currentExperience: WINRV2Experience | null = null;
  private serverSDKConfig: SDKConfig | null = null;
  /**
   * RTD opt-out — from the backend or the persisted local flag. Once true the
   * experience is never auto-presented.
   */
  private currentOptedOut = false;
  private autoOpenListenersAttached = false;
  /**
   * Cached "publisher suspended / service unavailable" state. Set when device
   * registration fails because the publisher's API key has been suspended or
   * revoked (billing lapse). Once set, the auto-open engine short-circuits
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

  /**
   * Submit the user's email and, if the backend adopts an existing account under
   * this publisher (cross-device streak unification), switch this session to that
   * canonical user's credentials so the streak follows the person across devices.
   * Tokens are read fresh on each request, so persisting them here is sufficient.
   */
  public static async submitEmailAndAdopt(request: SubmitEmailRequest): Promise<SubmitEmailResponse> {
    WINR.ensureConfigured();
    const response = await WINR.instance!.api.submitEmail(request);
    if (response.adopted && response.token && response.uuid) {
      const store = WINR.instance!.secureStorage;
      store.setItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN, response.token);
      if (response.refreshToken) {
        store.setItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);
      }
      store.setItem(WINR_CONSTANTS.STORAGE_KEYS.UUID, response.uuid);
      logger.info('Adopted existing account — streak unified across devices');
    }
    // The cached consent flag is otherwise only refreshed by getActiveGiveaway.
    // Set it here too so the auto-open engine's impression-cap check reads the
    // truth it just created rather than depending on the once-per-day mark
    // being evaluated first.
    WINR.instance!.currentEmailConsentStatus = true;
    return response;
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
   * revoked. Publishers can poll this to know whether the once-a-day
   * auto-open can occur, or to show their own "no longer available" message
   * elsewhere on the page.
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

      // Guest session: no user supplied. Mint (or re-load) the stable guest id
      // so attribution always carries a real identifier — bundle-scoped, same
      // persistence as the auto-open marks.
      if (!config.user) {
        // The WINR instance doesn't exist yet (it's constructed from this
        // config), so mint through a standalone provider — same class, same
        // backing store as the instance will use.
        const guestStore = new LocalStorageProvider();
        const guestKey = `${WINR_CONSTANTS.STORAGE_KEYS.GUEST_ID}_${config.bundleId}`;
        let guestId = guestStore.getItem(guestKey);
        if (!guestId) {
          guestId = `winr_guest_${crypto.randomUUID()}`;
          guestStore.setItem(guestKey, guestId);
        }
        config = { ...config, user: { id: guestId, firstName: '', lastName: '' } };
      }

      if (!config.user || !config.user.id) {
        throw new WINRError(
          WINRErrorCode.InvalidConfiguration,
          'User with id, firstName, and lastName is required'
        );
      }

      // Validate name characters/length (first_name / last_name per spec).
      // Guests have deliberately empty names — nothing to validate.
      const isGuestSession = config.user.id.startsWith('winr_guest_');
      if (!isGuestSession &&
          (!NAME_REGEX.test(config.user.firstName) || !NAME_REGEX.test(config.user.lastName))) {
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

      // V2 auto-open: the experience opens automatically on the first visit of
      // each calendar day (ALWAYS on; the only kill switch is the server-driven
      // sdkConfig.experience.autoOpenEnabled). Also re-checks when the tab
      // becomes visible again, covering the "tab stayed open overnight" case.
      if (typeof document !== 'undefined') {
        WINR.instance.attachAutoOpenListeners();
        void WINR.autoPresentIfEligible();
      }

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
   * Present the WINR experience as a modal.
   *
   * Internal-only: the experience is exclusively SDK-driven. It is opened by
   * the once-a-day auto-open engine ({@link WINR.autoPresentIfEligible}) and
   * cannot be launched manually by the host page.
   */
  private static async presentExperience(options?: PresentationOptions): Promise<void> {
    // If the publisher has been suspended, do NOT render the modal. Checked
    // before ensureConfigured() because a suspended configure() tears down the
    // instance.
    const unavailable = WINR.unavailableReason;
    if (unavailable) {
      logger.warn('presentExperience() called while WINR is unavailable — not rendering modal');
      options?.onError?.(unavailable);
      throw unavailable;
    }

    if (!WINR.ensureConfigured()) return;

    // RTD: an opted-out person never sees the experience again.
    if (WINR.instance!.isOptedOut()) {
      logger.info('presentExperience() suppressed: user opted out (RTD)');
      return;
    }

    // Don't stack on top of an already-presented experience.
    if (WINR.instance!.currentExperience) {
      logger.debug('presentExperience() skipped: experience already on screen');
      return;
    }

    let experience: WINRV2Experience | null = null;
    try {
      // Track presentation (the controller fetches fresh giveaway/claim state
      // itself in a single getActiveGiveaway round-trip after mount).
      analyticsAdapter.track('winr_modal_presented', {
        giveawayId: WINR.instance!.currentGiveaway?.id,
      });

      experience = WINR.instance!.createExperience(options);
      await experience.present();

    } catch (error) {
      // The mount failed before anything reached the screen — release the
      // "already on screen" guard so a later (re-)check can present again.
      // (Read through a local to sidestep TS's stale narrowing from the
      // pre-try guard above.)
      const current = WINR.instance
        ? (WINR.instance.currentExperience as WINRV2Experience | null)
        : null;
      if (experience && current === experience) {
        WINR.instance!.currentExperience = null;
      }
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
   * Dismiss any currently presented modal
   */
  public static dismiss(): void {
    if (!WINR.ensureConfigured()) return;

    if (WINR.instance!.currentExperience) {
      WINR.instance!.currentExperience.dismiss();
      WINR.instance!.currentExperience = null;

      analyticsAdapter.track('winr_modal_dismissed');
      logger.debug('Modal dismissed');
    }
  }

  // ─── V2 experience wiring ───

  /**
   * Builds the V2 experience (state-machine controller + shadow-DOM root).
   * The controller re-fetches getActiveGiveaway on mount, auto-claims when
   * eligible, and keeps this instance's caches in sync via the refresh hook.
   */
  private createExperience(options?: PresentationOptions): WINRV2Experience {
    const controller = new V2ExperienceController({
      api: this.api,
      storage: this.storage,
      bundleId: this.config.bundleId,
      submitEmailAndAdopt: (request) =>
        WINR.submitEmailAndAdopt({ ...request, publisherUserId: this.resolvedUser.id }),
      verifyAdoptionCode: (request) =>
        this.client.post('/verifyAdoptionCode', request),
      optOut: () => WINR.optOutFromExperience(),
      hasRegisteredUuid: () =>
        this.secureStorage.getItem(WINR_CONSTANTS.STORAGE_KEYS.UUID) !== null,
      userPrefill: {
        firstName: this.resolvedUser.firstName,
        lastName: this.resolvedUser.lastName,
        ...(this.resolvedUser.phone ? { phone: this.resolvedUser.phone } : {}),
        ...(this.resolvedUser.email ? { email: this.resolvedUser.email } : {}),
      },
      cachedGiveaway: this.currentGiveaway,
      cachedSdkConfig: this.getCurrentSDKConfig(),
      cachedClaimedToday: this.currentClaimedToday,
      onGiveawayRefreshed: (response) => this.onGiveawayResponse(response),
      resolveSdkConfig: () => this.getCurrentSDKConfig(),
    });

    const wrappedOptions: PresentationOptions = {
      ...(options ?? {}),
      onClose: () => {
        this.currentExperience = null;
        options?.onClose?.();
      },
    };

    const experience = new WINRV2Experience(controller, wrappedOptions);
    this.currentExperience = experience;
    return experience;
  }

  /** Keeps instance caches in sync with each getActiveGiveaway response. */
  private onGiveawayResponse(response: GetActiveGiveawayResponse): void {
    if (response.giveaway === null) {
      this.currentGiveaway = null;
      this.storage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY);
    } else {
      this.currentGiveaway = response.giveaway;
      this.storage.setItem(
        WINR_CONSTANTS.STORAGE_KEYS.CACHED_GIVEAWAY,
        JSON.stringify(response.giveaway)
      );
    }

    this.currentClaimedToday = response.claimedToday === true;
    this.currentEmailConsentStatus = response.emailConsentStatus === true;
    if (response.optedOut === true) this.markOptedOut();
    if (response.sdkConfig) this.serverSDKConfig = response.sdkConfig;

    // Backend is the source of truth for the streak — seed the local state so
    // it follows the person across sessions and devices.
    if (typeof response.streakDay === 'number') {
      const existing = this.getStreakState();
      this.setStreakState({
        currentDay: response.streakDay,
        lastClaimedDate: response.claimedToday ? new Date() : existing?.lastClaimedDate,
        totalEntriesEarned: response.totalEntries ?? existing?.totalEntriesEarned ?? 0,
        weeklyCurrent: response.weeklyCurrent ?? existing?.weeklyCurrent ?? 0,
        monthlyCurrent: response.monthlyCurrent ?? existing?.monthlyCurrent ?? 0,
      } as StreakState);
    }

    this.prewarmPublisherArt();
  }

  /**
   * Pulls the publisher's remote art (prize hero + logo) into the browser's
   * image cache as soon as the SDK learns the giveaway config — at
   * registration AND on every giveaway refresh — so the drawer paints the
   * prize card complete on its first frame instead of the art popping in
   * after everything else. Fire-and-forget; failures just fall back to
   * loading at display time (see prewarmImage).
   */
  private prewarmPublisherArt(): void {
    prewarmImage(this.currentGiveaway?.prizeImageUrl);
    prewarmImage(this.getCurrentSDKConfig().branding?.logoUrl);
  }

  // ─── Auto-present (V2 experience: open once per day) ───

  /**
   * The configured user. configure() always resolves one — a supplied user or
   * the minted guest — before storing config, so this never throws in practice;
   * the throw documents the invariant rather than handling a real path.
   */
  private get resolvedUser(): WINRUser {
    const u = this.config.user;
    if (!u) throw new WINRError(WINRErrorCode.InvalidConfiguration, 'configure() has not run');
    return u;
  }

  private get lastAutoPresentKey(): string {
    return `${WINR_CONSTANTS.STORAGE_KEYS.LAST_AUTO_PRESENT}_${this.config.bundleId}`;
  }

  private get unregisteredImpressionsKey(): string {
    return `${WINR_CONSTANTS.STORAGE_KEYS.UNREGISTERED_IMPRESSIONS}_${this.config.bundleId}`;
  }

  private get optedOutKey(): string {
    return `${WINR_CONSTANTS.STORAGE_KEYS.OPTED_OUT}_${this.config.bundleId}`;
  }

  private isOptedOut(): boolean {
    return this.currentOptedOut || this.storage.getItem(this.optedOutKey) === 'true';
  }

  /** Persist the RTD flag so the suppression holds on future loads, offline too. */
  private markOptedOut(): void {
    this.currentOptedOut = true;
    this.storage.setItem(this.optedOutKey, 'true');
  }

  private static dayString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Auto-open re-checks on tab visibility/focus (day-rollover while open). */
  private attachAutoOpenListeners(): void {
    if (this.autoOpenListenersAttached || typeof document === 'undefined') return;
    this.autoOpenListenersAttached = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void WINR.autoPresentIfEligible();
    });
    window.addEventListener('focus', () => void WINR.autoPresentIfEligible());
  }

  /**
   * Presents the experience automatically, at most once per calendar day, when
   * all conditions allow. Runs after configure() completes and on each tab
   * foreground. All short-circuits are silent by design. Mirrors iOS:
   *  - server kill switch: sdkConfig.experience.autoOpenEnabled
   *  - unregistered (no confirmed email) users are capped at
   *    experience.unregisteredImpressionCap auto-opens (default 3)
   *  - RTD opted-out users never see it
   */
  private static async autoPresentIfEligible(): Promise<void> {
    if (!WINR.isConfigured || !WINR.instance) return;
    if (typeof document === 'undefined') return;
    const instance = WINR.instance;

    if (WINR.serviceUnavailable || instance.serviceUnavailableError) return;
    if (instance.isOptedOut()) return;

    const experience = instance.serverSDKConfig?.experience;
    if (experience?.autoOpenEnabled === false) return; // server kill switch
    if (!instance.currentGiveaway) return;

    // configure() is typically called from a <head> script — before the parser
    // has created <body>. Mounting the shadow-DOM host would throw, so defer
    // the WHOLE check (no eligibility marks are written) until the DOM is
    // ready, then re-run it.
    if (!document.body) {
      document.addEventListener(
        'DOMContentLoaded',
        () => void WINR.autoPresentIfEligible(),
        { once: true }
      );
      return;
    }

    // Once per calendar day.
    const today = WINR.dayString(new Date());
    if (instance.storage.getItem(instance.lastAutoPresentKey) === today) return;

    // Don't stack on top of an already-presented experience.
    if (instance.currentExperience) return;

    // Unregistered users (no confirmed email) see the auto-open at most N
    // times, then the SDK goes quiet until they register or the publisher
    // opens it manually.
    const emailConsent =
      instance.currentEmailConsentStatus ||
      instance.storage.getItem(emailSubmittedStorageKey(instance.config.bundleId)) === 'true';
    let seen = 0;
    if (!emailConsent) {
      const cap = experience?.unregisteredImpressionCap ?? 3;
      seen = parseInt(
        instance.storage.getItem(instance.unregisteredImpressionsKey) ?? '0',
        10
      );
      if (seen >= cap) {
        logger.debug(`Auto-present skipped: unregistered impression cap (${cap}) reached`);
        return;
      }
      instance.storage.setItem(instance.unregisteredImpressionsKey, String(seen + 1));
    }

    // The once-per-day mark (and the unregistered impression above) is burned
    // up front so a midnight-crossing session can't double-open — but ROLLED
    // BACK if the presentation never made it on screen, so the DOM-ready /
    // visibility re-checks can retry instead of going silent for the day.
    instance.storage.setItem(instance.lastAutoPresentKey, today);
    logger.info('Auto-presenting WINR experience (first visit of the day)');
    await WINR.presentExperience().catch(() => {
      if (instance.storage.getItem(instance.lastAutoPresentKey) === today) {
        instance.storage.removeItem(instance.lastAutoPresentKey);
      }
      if (!emailConsent) {
        instance.storage.setItem(instance.unregisteredImpressionsKey, String(seen));
      }
    });
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
   * Right-To-Delete opt-out: tombstones the person on the backend
   * (identity-wide, PII anonymized, email suppressed) and permanently
   * silences the experience in this browser. Wire this to the opt-out
   * action in your privacy-policy flow. Parity with the mobile SDKs'
   * `WINR.optOut()`.
   */
  public static async optOut(): Promise<void> {
    if (!WINR.ensureConfigured()) return;

    // A right-to-delete request MUST reach the backend. If the network call
    // fails we throw and mark NOTHING locally — silencing the client on a
    // failed erasure would drop the request forever (there is no later
    // registration to "catch up", because the client is now silent). The
    // caller surfaces the error and lets the user retry. Only on confirmed
    // success do we suppress locally.
    const res = await WINR.instance!.client.post<{ success?: boolean }>('/optOut', {});
    if (res && res.success === false) {
      throw new Error('opt-out was not accepted by the server');
    }
    WINR.instance!.markOptedOut();
    analyticsAdapter.track('winr_opted_out');
    logger.info('User opted out — experience permanently suppressed');
  }

  /**
   * The in-experience RTD opt-out (how-it-works "Privacy choices" → DELETE
   * MY DATA). Unlike the public {@link optOut}, a failed backend call THROWS
   * and marks NOTHING locally — the experience shows an honest error and the
   * user can retry; the deletion is only announced once the backend has
   * actually tombstoned the person.
   */
  private static async optOutFromExperience(): Promise<void> {
    if (!WINR.ensureConfigured()) throw new Error('WINR is not configured');
    await WINR.instance!.client.post<{ success?: boolean }>('/optOut', {});
    WINR.instance!.markOptedOut();
    analyticsAdapter.track('winr_opted_out');
    logger.info('User opted out via in-experience privacy choices — experience permanently suppressed');
  }

  /**
   * Right-to-be-Forgotten (GDPR/CCPA)
   *
   * `deleteUserData()` was REMOVED. It called a backend hard-delete that wiped the
   * user's entries, leaving no tombstone — so delete -> re-register -> claim again
   * the same day farmed unlimited entries. It also destroyed the records proving the
   * drawing was fair, and left prize-claim PII orphaned.
   *
   * Use `optOut()` instead. It is the correct erasure: identity-wide, PII scrubbed
   * everywhere including prize claims, tombstoned so it survives a reinstall, and
   * the experience stays permanently silenced on the device.
   */

  /**
   * Register for push notifications
   */
  public static async registerForPushNotifications(): Promise<void> {
    if (!WINR.ensureConfigured()) return;

    // Gate on the publisher opt-in, exactly like the mobile SDKs: with
    // `enablePushReminders` unset we never prompt for notification permission.
    if (!WINR.instance!.config.options?.enablePushReminders) {
      logger.debug(
        'Push reminders not enabled (options.enablePushReminders) — skipping registration'
      );
      return;
    }

    // HONEST NO-OP. Functional web push needs a VAPID application-server key
    // AND a registered service worker to mint a PushSubscription the backend
    // can deliver to — neither is shipped or exposed as config in this SDK
    // build. The previous implementation only requested Notification
    // permission and never called `api.registerPushToken`, so it produced a
    // permission prompt but no registered token: the reminder could never
    // actually be sent. Rather than fake it, we do nothing here (beyond
    // respecting the opt-in flag) until VAPID + a service worker are wired up
    // and the resulting subscription is POSTed via api.registerPushToken.
    logger.info(
      'web push not configured (no VAPID key / service worker) — push registration is a no-op'
    );
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

      // The backend returns the user identifier from the handshake. It is currently a
      // Firestore document ID (not a UUID v4), so accept any non-empty identifier rather
      // than enforcing a v4 shape that the server doesn't emit. (If user_uid is migrated
      // to UUID v4 server-side per spec #22, tighten this back up.)
      if (!response.uuid || typeof response.uuid !== 'string') {
        logger.error('registerDevice returned no user identifier:', response.uuid);
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

      // Registration is the EARLIEST moment the SDK knows the prize art /
      // logo URLs — start the download now, long before the drawer opens.
      this.prewarmPublisherArt();

      // Per-user backend truth used by the auto-open engine (impression cap,
      // RTD suppression) before the first getActiveGiveaway round-trip.
      this.currentClaimedToday = response.claimedToday === true;
      if (response.emailConsentStatus === true) {
        this.currentEmailConsentStatus = true;
        this.storage.setItem(emailSubmittedStorageKey(this.config.bundleId), 'true');
      }
      if (response.optedOut === true) this.markOptedOut();

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
      // V2 uses ONLY logoUrl + primaryColor from branding — the design is
      // hardcoded otherwise. Other fields survive for API compatibility.
      branding: {
        primaryColor: serverBranding?.primaryColor || clientBranding?.primaryColor,
        secondaryColor: serverBranding?.secondaryColor || clientBranding?.secondaryColor,
        backgroundColor: serverBranding?.backgroundColor || clientBranding?.backgroundColor,
        logoUrl: serverBranding?.logoUrl || clientBranding?.logoUrl,
        fontFamily: serverBranding?.fontFamily || clientBranding?.fontFamily,
      },
      copy: this.serverSDKConfig?.copy || {},
      bonusEntriesEnabled: this.serverSDKConfig?.bonusEntriesEnabled,
      rulesUrl: this.serverSDKConfig?.rulesUrl,
      ageGateEnabled: this.serverSDKConfig?.ageGateEnabled ?? this.config.options?.enableAgeGate ?? true,
      ageGateMinAge: this.serverSDKConfig?.ageGateMinAge ?? this.config.options?.ageGateMinAge ?? 18,
      experience: this.serverSDKConfig?.experience,
    };
  }
}
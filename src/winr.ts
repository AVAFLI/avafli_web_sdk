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
import { WINRModal } from './ui/winr-modal';
import { StreakEngine } from './domain/streak-engine';
import { LocalStorageProvider } from './storage/local-storage';
import { logger } from './services/logger';
import { analyticsAdapter } from './services/analytics';

/**
 * Main WINR Web SDK class
 * Singleton pattern for global access
 */
export class WINR {
  private static instance: WINR | null = null;
  private static isConfigured = false;

  private client: NetworkClient;
  private config: WINRConfiguration;
  private currentUser: WINRUser | null = null;
  private currentGiveaway: Giveaway | null = null;
  private streakEngine: StreakEngine;
  private storage: LocalStorageProvider;
  private deviceFingerprint: string | null = null;
  private currentModal: WINRModal | null = null;
  private serverSDKConfig: SDKConfig | null = null;

  private constructor(config: WINRConfiguration) {
    this.config = config;
    this.storage = new LocalStorageProvider();
    this.streakEngine = new StreakEngine();
    
    // Initialize network client
    this.client = new NetworkClient({
      baseURL: WINR_CONSTANTS.getApiBaseUrl(config.options?.environment),
      apiKey: config.apiKey,
      tokenProvider: () => this.storage.getItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN),
      refreshHandler: () => this.refreshToken(),
      logger: logger,
    });
  }

  /**
   * Configure the WINR SDK
   */
  public static async configure(config: WINRConfiguration): Promise<void> {
    if (WINR.isConfigured) {
      logger.warn('WINR already configured, skipping reconfiguration');
      return;
    }

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
      
      // Clear local storage
      WINR.instance!.storage.clear();
      
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

      // Store authentication tokens
      this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN, response.token);
      this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);
      this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.UUID, response.uuid);

      // Store giveaway data and server SDK config
      this.currentGiveaway = response.giveaway;
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
      logger.error('Device registration failed:', error);
      throw error;
    }
  }

  private async refreshToken(): Promise<string | null> {
    const refreshToken = this.storage.getItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN);
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
      this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN, response.token);
      this.storage.setItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);

      logger.debug('Token refreshed successfully');
      return response.token;
      
    } catch (error) {
      logger.error('Token refresh failed:', error);
      // Clear invalid tokens
      this.storage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.TOKEN);
      this.storage.removeItem(WINR_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN);
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
      this.currentGiveaway = response.giveaway;
      if (response.sdkConfig) {
        this.serverSDKConfig = response.sdkConfig;
      }
      
      logger.debug('Giveaway data refreshed');
      
    } catch (error) {
      logger.warn('Failed to refresh giveaway data:', error);
      // Continue with cached data
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
      ageGateMinAge: this.serverSDKConfig?.ageGateMinAge ?? this.config.options?.ageGateMinAge ?? 13,
    };
  }
}
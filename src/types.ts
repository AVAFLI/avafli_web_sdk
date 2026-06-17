/**
 * Core types and interfaces for the WINR Web SDK
 */

// ─── Configuration Types ───

export interface WINROptions {
  /** API environment */
  environment?: 'production' | 'staging' | 'qa';
  /** Enable debug logging */
  debug?: boolean;
  /** Enable streak reminder push notifications */
  enablePushReminders?: boolean;
  /** Age gate minimum age */
  ageGateMinAge?: number;
  /** Enable age verification */
  enableAgeGate?: boolean;
  /** Custom analytics adapter */
  analyticsAdapter?: AnalyticsAdapter;
  /** Custom rewarded video provider */
  rewardedVideoProvider?: RewardedVideoProvider;
  /** Custom device fingerprint function */
  deviceFingerprintProvider?: () => Promise<string>;
}

export interface WINRConfiguration {
  /** Publisher API key */
  apiKey: string;
  /** Application bundle/package identifier */
  bundleId: string;
  /** Current user — required */
  user: WINRUser;
  /** SDK configuration options */
  options?: WINROptions;
  /** Custom branding configuration */
  branding?: WINRBranding;
}

export interface WINRBranding {
  /** Primary color (hex) */
  primaryColor?: string;
  /** Secondary color (hex) */
  secondaryColor?: string;
  /** Background color (hex) */
  backgroundColor?: string;
  /** Logo URL */
  logoUrl?: string;
  /** Custom font family */
  fontFamily?: string;
}

export interface WINRUser {
  /** User ID */
  id: string;
  /** First name */
  firstName: string;
  /** Last name */
  lastName: string;
  /** Phone number */
  phone?: string;
}

// ─── Domain Types ───

export interface StreakState {
  /** Current daily streak (1-6) */
  currentDay: number;
  /** Last claim date */
  lastClaimedDate?: Date;
  /** Total entries earned across all time */
  totalEntriesEarned: number;
  /** Weekly streak current count */
  weeklyCurrent: number;
  /** Week start date (YYYY-MM-DD) */
  weeklyStart?: string;
  /** Monthly streak current count */
  monthlyCurrent: number;
  /** Month start date (YYYY-MM-01) */
  monthlyStart?: string;
}

export interface StreakConfig {
  /** Day of week for weekly reset (0=Sunday) */
  weeklyResetDay: number;
  /** Day of month for monthly reset */
  monthlyResetDay: number;
  /** Days needed for weekly bonus */
  weeklyBonusThreshold: number;
  /** Weekly bonus entries amount */
  weeklyBonusEntries: number;
  /** Days needed for monthly bonus */
  monthlyBonusThreshold: number;
  /** Monthly bonus entries amount */
  monthlyBonusEntries: number;
}

export interface MilestoneConfig {
  /** Day threshold for milestone */
  day: number;
  /** Bonus entries awarded */
  bonusEntries: number;
  /** Badge identifier */
  badge?: string;
}

export interface MilestoneAward {
  /** Day achieved */
  day: number;
  /** Bonus entries awarded */
  bonusEntries: number;
  /** Badge earned */
  badge?: string;
}

export interface Giveaway {
  /** Giveaway ID */
  id: string;
  /** Giveaway title */
  title: string;
  /** Prize description */
  prizeDescription: string;
  /** Prize value in dollars */
  prizeValue: number;
  /** Start date (ISO string) */
  startDate: string;
  /** End date (ISO string) */
  endDate: string;
  /** Base entries for streak days [day1, day2, ..., day6] */
  streakLadder: number[];
  /** Whether doubling is enabled */
  doublingEnabled: boolean;
  /** Maximum daily base entries */
  maxDailyBaseEntries: number;
  /** Rules URL */
  rulesUrl: string;
  /** Streak configuration */
  streakConfig: StreakConfig;
  /** Milestone configurations */
  milestones: MilestoneConfig[];
  /** Ad provider configuration */
  adConfig?: AdConfig;
}

export interface AdConfig {
  /** Ad provider type */
  provider: 'applovin' | 'admob' | 'unity' | 'ironsource' | 'none';
  /** App key for the ad provider */
  appKey?: string;
  /** Ad unit ID */
  adUnitId?: string;
  /** Placement name */
  placementName?: string;
}

export interface DailyEntryGrant {
  /** Base entries granted */
  entries: number;
  /** Current streak day */
  streakDay: number;
  /** Total entries earned */
  totalEntries: number;
  /** Weekly bonus entries if awarded */
  weeklyBonusEntries?: number;
  /** Monthly bonus entries if awarded */
  monthlyBonusEntries?: number;
  /** Milestone if achieved */
  milestone?: MilestoneAward;
}

// ─── Network Types ───

export interface RegisterDeviceRequest {
  apiKey: string;
  deviceFingerprint: string;
  bundleId: string;
  timezone?: string;
  platformOS?: string;
  sdkVersion?: string;
}

export interface RegisterDeviceResponse {
  /** Firebase ID token */
  token: string;
  /** Refresh token */
  refreshToken: string;
  /** User UUID */
  uuid: string;
  /** Active giveaway */
  giveaway: Giveaway | null;
  /** Whether user is returning */
  isReturningUser?: boolean;
  /** Whether user claimed today */
  claimedToday: boolean;
  /** Current streak day */
  streakDay: number;
  /** Total entries */
  totalEntries: number;
  /** SDK configuration */
  sdkConfig?: SDKConfig | null;
}

export interface SDKCopy {
  // Nested per-screen
  emailCapture?: {
    prizeHeadline?: string;
    title?: string;
    subtitle?: string;
    emailLabel?: string;
    emailPlaceholder?: string;
    ageGateText?: string;
    submitButton?: string;
    rulesPrefix?: string;
    rulesLinkText?: string;
    emailConsentText?: string;
  };
  streakDashboard?: {
    prizeHeadline?: string;
    streakMessage?: string;
    upcomingLabel?: string;
    claimButton?: string;
    dayRewardLabel?: string;
    claimDescription?: string;
    entriesLabel?: string;
    bonusProgressLabel?: string;
    weekLabel?: string;
    monthLabel?: string;
    bonusEarnedText?: string;
  };
  alreadyClaimed?: {
    title?: string;
    subtitle?: string;
    doneButton?: string;
  };
  bonusEntries?: {
    title?: string;
    subtitle?: string;
    watchButton?: string;
    skipText?: string;
  };
  milestone?: {
    title?: string;
    subtitle?: string;
    continueButton?: string;
  };
  completed?: {
    title?: string;
    subtitle?: string;
    closeButton?: string;
  };
  error?: {
    title?: string;
    subtitle?: string;
    closeButton?: string;
  };
  noActiveGiveaway?: {
    title?: string;
    subtitle?: string;
    closeButton?: string;
  };
  howItWorks?: {
    title?: string;
    subtitle?: string;
    step1Title?: string;
    step1Desc?: string;
    step2Title?: string;
    step2Desc?: string;
    step3Title?: string;
    step3Desc?: string;
    step4Title?: string;
    step4Desc?: string;
    tipText?: string;
    gotItButton?: string;
  };
  loading?: {
    text?: string;
  };
  // Flat backward compat
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  dailyClaimButton?: string;
  streakMessage?: string;
  emailConsentText?: string;
  ageGateText?: string;
  rulesLinkText?: string;
}

export interface ScreenMedia {
  imageUrl?: string;
  lottieUrl?: string;
}

export interface SDKMedia {
  emailCapture?: ScreenMedia;
  streakDashboard?: ScreenMedia;
  bonusEntries?: ScreenMedia;
  milestone?: ScreenMedia;
  completed?: ScreenMedia;
  howItWorks?: ScreenMedia;
}

export interface SDKConfig {
  /** Branding overrides */
  branding?: WINRBranding;
  /** Copy/text overrides */
  copy?: SDKCopy;
  /** Media/asset overrides */
  media?: SDKMedia;
  /** Rules URL override */
  rulesUrl?: string;
  /** Age gate enabled */
  ageGateEnabled?: boolean;
  /** Minimum age for age gate */
  ageGateMinAge?: number;
  /** Feature flag: show bonus entries (watch video) screen in SDK flow */
  bonusEntriesEnabled?: boolean;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  /** New ID token */
  token: string;
  /** New refresh token */
  refreshToken: string;
}

export interface GetActiveGiveawayResponse {
  /** Active giveaway */
  giveaway: Giveaway | null;
  /** Whether user claimed today */
  claimedToday: boolean;
  /** Current streak day */
  streakDay: number;
  /** SDK configuration */
  sdkConfig?: SDKConfig | null;
}

export interface ClaimDailyEntriesResponse {
  /** Entries granted */
  entries: number;
  /** Streak day */
  streakDay: number;
  /** Total entries */
  totalEntries: number;
  /** Weekly bonus entries if awarded */
  weeklyBonusEntries?: number;
  /** Monthly bonus entries if awarded */
  monthlyBonusEntries?: number;
  /** Milestone if achieved */
  milestone?: MilestoneAward;
}

export interface ClaimBonusEntriesResponse {
  /** Bonus entries granted */
  bonusEntries: number;
  /** Total entries */
  totalEntries: number;
}

export interface SubmitEmailRequest {
  email: string;
  marketingConsent?: boolean;
  publisherUserId?: string;
}

export interface SubmitEmailResponse {
  success: boolean;
}

export interface SubmitUserProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  smsConsent: boolean;
  maidId?: string;
  publisherUserId?: string;
}

export interface SubmitUserProfileResponse {
  success: boolean;
}

export interface DeleteUserDataResponse {
  success: boolean;
}

// ─── Error Types ───

export enum WINRErrorCode {
  NotConfigured = 'not_configured',
  InvalidState = 'invalid_state',
  AuthenticationRequired = 'authentication_required',
  NetworkError = 'network_error',
  IneligibleToday = 'ineligible_today',
  GiveawayNotActive = 'giveaway_not_active',
  InvalidEmail = 'invalid_email',
  AgeVerificationRequired = 'age_verification_required',
  RewardedVideoUnavailable = 'rewarded_video_unavailable',
  InvalidConfiguration = 'invalid_configuration',
  /**
   * The WINR experience is not available for this publisher — e.g. the
   * publisher's account/API key has been suspended or revoked (billing lapse).
   * The SDK degrades gracefully: the default modal is not rendered, and custom
   * UI can query {@link WINR.isAvailable} to show its own messaging.
   */
  ServiceUnavailable = 'service_unavailable',
}

export class WINRError extends Error {
  constructor(
    public code: WINRErrorCode,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'WINRError';
  }
}

// ─── Service Interfaces ───

export interface StorageProvider {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export interface AnalyticsAdapter {
  /** Track event */
  track(event: string, properties?: Record<string, unknown>): void;
  /** Identify user */
  identify(userId: string, traits?: Record<string, unknown>): void;
}

export interface RewardedVideoProvider {
  /** Check if rewarded video is available */
  isAvailable(): Promise<boolean>;
  /** Show rewarded video */
  show(): Promise<{ success: boolean; reward?: { type: string; amount: number } }>;
  /** Load rewarded video */
  load(): Promise<void>;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ─── UI Types ───

export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    success: string;
    error: string;
    warning: string;
  };
  fonts: {
    family: string;
    sizes: {
      sm: string;
      base: string;
      lg: string;
      xl: string;
      '2xl': string;
      '3xl': string;
    };
    weights: {
      normal: string;
      medium: string;
      semibold: string;
      bold: string;
    };
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    '2xl': string;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
    full: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}

export interface PresentationOptions {
  /** Container element ID for inline presentation */
  containerId?: string;
  /** Close callback */
  onClose?: () => void;
  /** Completion callback */
  onComplete?: (result: DailyEntryGrant) => void;
  /** Error callback */
  onError?: (error: WINRError) => void;
}

// ─── Constants ───

export const WINR_CONSTANTS = {
  SDK_VERSION: '1.0.0',
  PLATFORM_OS: 'Web',
  getApiBaseUrl: (environment: 'production' | 'staging' | 'qa' = 'production'): string => {
    switch (environment) {
      case 'production':
        return 'https://us-central1-winr-9c11f.cloudfunctions.net';
      case 'staging':
        return 'https://us-central1-winr-staging.cloudfunctions.net';
      case 'qa':
        return 'https://us-central1-winr-qa.cloudfunctions.net';
    }
  },
  DEFAULT_STREAK_LADDER: [10, 30, 60, 130, 240, 300],
  STORAGE_KEYS: {
    TOKEN: 'winr_token',
    REFRESH_TOKEN: 'winr_refresh_token',
    UUID: 'winr_uuid',
    STREAK_STATE: 'winr_streak_state',
    EMAIL_SUBMITTED: 'winr_email_submitted',
    LAST_CLAIM_DATE: 'winr_last_claim_date',
    DEVICE_FINGERPRINT: 'winr_device_fingerprint',
    CACHED_GIVEAWAY: 'winr_cached_giveaway',
  },
  DEFAULT_MILESTONES: [
    { day: 5, bonusEntries: 10 },
    { day: 15, bonusEntries: 50, badge: 'silver' },
    { day: 25, bonusEntries: 200, badge: 'gold' },
  ] as MilestoneConfig[],
} as const;
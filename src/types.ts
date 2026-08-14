/**
 * Core types and interfaces for the WINR Web SDK
 */

// ─── Configuration Types ───

export interface WINROptions {
  /** API environment */
  environment?: 'production';
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
  /** Custom device fingerprint function */
  deviceFingerprintProvider?: () => Promise<string>;
}

export interface WINRConfiguration {
  /** Publisher API key */
  apiKey: string;
  /** Application bundle/package identifier */
  bundleId: string;
  /**
   * Current user. OMIT for a guest session (logged out / no account system) —
   * the SDK mints a stable per-install guest id (`winr_guest_…`) and uses it
   * for attribution, so there is always a real identifier without your
   * integration fabricating one. The experience is fully functional for
   * guests; when your user signs in, call configure again with the real user
   * and attribution upgrades in place (the streak is device-anchored and
   * unaffected).
   */
  user?: WINRUser;
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
  /** User ID (the only required field) */
  id: string;
  /** First name (optional — the SDK collects it at prize-claim if missing) */
  firstName?: string;
  /** Last name (optional — the SDK collects it at prize-claim if missing) */
  lastName?: string;
  /** Phone number */
  phone?: string;
  /**
   * The user's email from YOUR authenticated session (optional).
   *
   * When supplied, the WINR capture screen shows it pre-filled and READ-ONLY —
   * the user cannot swap in a different address. Deliberate: WINR links
   * accounts across devices by email, so a free-typed address lets a user
   * attach themselves to someone else's record. Supplying it never records any
   * consent — the user still ticks the boxes and submits inside the WINR flow.
   * A malformed value is ignored and the field stays editable.
   */
  email?: string;
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
  /** Milestone configurations */
  milestones: MilestoneConfig[];
  /** Ad provider configuration */
  adConfig?: AdConfig;
  /**
   * Publisher-configurable prize art for the V2 prize card. Absent → the SDK
   * renders the bundled default cash hero with "WIN $X" overlay.
   */
  prizeImageUrl?: string;
  /**
   * "daily" (default) = consecutive-day streak that resets on a miss.
   * "visit" = visit-count streak for low-frequency sites; never resets
   * ("VISIT N" + "Come back again" copy).
   */
  streakMode?: 'daily' | 'visit';
  /**
   * Most recent drawn winner for this giveaway chain — drives the
   * "WE HAVE A WINNER!" banner + winners dialog. Absent → no banner.
   */
  latestWinner?: GiveawayWinner;
}

export interface GiveawayWinner {
  /** Display name, e.g. "Catherine C." */
  name: string;
  /** e.g. "Brooklyn, New York" */
  location?: string;
  avatarUrl?: string;
  /** "yyyy-MM-dd" */
  awardedAt?: string;
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
  /**
   * Soft email-verification signal. `false` means this person typed a
   * brand-new email that hasn't been confirmed yet — drives the persistent
   * "Verify your email" chip. ABSENT/undefined for verified users,
   * partner-passed emails, adoption-verified users, and users with no email:
   * treat ONLY an explicit `false` as unverified. Never gates daily play —
   * verification only affects prize-draw eligibility (enforced server-side).
   */
  emailVerified?: boolean;
  /** Whether user claimed today */
  claimedToday: boolean;
  /** Current streak day */
  streakDay: number;
  /** Total entries */
  totalEntries: number;
  /** Whether this user has confirmed an email + consent */
  emailConsentStatus?: boolean;
  /** True when this person has opted out (RTD) — never show the experience. */
  optedOut?: boolean;
  /** SDK configuration */
  sdkConfig?: SDKConfig | null;
  /**
   * Present only when this person is the drawn winner of one of this
   * publisher's giveaways (winner prize-claim flow).
   */
  prizeClaim?: PrizeClaimBlock;
  /**
   * True when this device started a cross-device adoption (typed an email
   * that matched an existing account) but never completed the 6-digit code —
   * the next drawer-open routes to the code screen after calling
   * `restageAdoption` (which re-sends a fresh code). OPTIONAL: absent on
   * production backends that don't emit it yet.
   */
  adoptionPending?: boolean;
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
    /**
     * Label for the MARKETING-consent checkbox. The backend supplies a
     * publisher-named string ("I agree to receive marketing emails from
     * {PublisherName}"); the SDK renders it verbatim. Key name kept for wire
     * compatibility.
     */
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

/** Server-driven experience behavior flags (V2 auto-open flow). */
export interface ExperienceConfig {
  /** Auto-present the experience on the first visit of the day (default true). */
  autoOpenEnabled?: boolean;
  /**
   * How many times an unregistered (no-email) user sees the auto-presented
   * experience before it goes quiet (default 3 — MVP decision).
   */
  unregisteredImpressionCap?: number;
  /** Dismissal requires an explicit click; never auto-fade (default true). */
  requireDismissClick?: boolean;
}

export interface SDKConfig {
  /** Branding overrides (V2 uses ONLY logoUrl + primaryColor) */
  branding?: WINRBranding;
  /**
   * Copy/text overrides. NOTE: the V2 experience hardcodes its copy to the
   * design; this survives on the payload for backward compatibility only.
   */
  copy?: SDKCopy;
  /** Rules URL override */
  rulesUrl?: string;
  /**
   * Publisher share link used by the winner share step's social actions
   * (X/Facebook intents, Web Share API). OPTIONAL: absent on production
   * backends that don't emit it yet — share actions degrade to text-only.
   */
  shareUrl?: string;
  /** Age gate enabled */
  ageGateEnabled?: boolean;
  /** Minimum age for age gate */
  ageGateMinAge?: number;
  /** Feature flag: bonus entries (parked for Phase 1 — unused by V2) */
  bonusEntriesEnabled?: boolean;
  /** Experience behavior (V2 auto-open flow). Absent → SDK defaults apply. */
  experience?: ExperienceConfig;
  /**
   * Google Places API (New) key enabling address autocomplete on the claim
   * form's street field. OPTIONAL — absent means the address step renders
   * exactly as plain fields (no Places calls are ever made).
   */
  placesApiKey?: string;
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
  /** Total entries earned to date (backend is source of truth) */
  totalEntries?: number;
  /** Weekly / monthly bonus progress */
  weeklyCurrent?: number;
  monthlyCurrent?: number;
  /** Whether this user has confirmed an email + consent. Drives the email-capture
   * gate so a recognized user isn't asked to re-enter their email on reopen. */
  emailConsentStatus?: boolean;
  /**
   * Soft email-verification signal (see {@link RegisterDeviceResponse.emailVerified}).
   * ONLY an explicit `false` means "unverified" and shows the verify chip;
   * absent for verified/partner/adoption/no-email users. Never blocks play.
   */
  emailVerified?: boolean;
  /** Lifetime claim count */
  lifetimeCount?: number;
  /** True when this person has opted out (RTD) — never show the experience. */
  optedOut?: boolean;
  /** SDK configuration */
  sdkConfig?: SDKConfig | null;
  /**
   * Present only when this person is the drawn winner of one of this
   * publisher's giveaways and the winner record is still claimable.
   * `status === "pending"` drives the winner splash → claim form flow;
   * `"submitted"` means the form was already sent (normal dashboard shows).
   */
  prizeClaim?: PrizeClaimBlock;
}

// ─── Prize Claim (winner flow) ───

/** FIXED API contract, mirroring `PrizeClaimBlock` in the backend's types.ts. */
export interface PrizeClaimBlock {
  status: 'pending' | 'submitted';
  giveawayId: string;
  prizeDescription: string;
  prizeValue: number;
  /**
   * Display-only masked winning email ("d********r@winr.example.com") for
   * the claim form's locked field. Absent from older backends.
   */
  maskedEmail?: string;
  /** Present when submitted. */
  claimNumber?: string;
  /** ISO date, when submitted. */
  submittedAt?: string;
}

/** Payload for `submitPrizeClaim` (exact backend field names). */
export interface SubmitPrizeClaimRequest {
  giveawayId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  street: string;
  apt?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  photoBase64?: string;
  /**
   * Winner story. LEGACY on this payload: 2.9+ clients no longer send it
   * here — the story is typed on the post-submit share step and attached via
   * the `attachClaimStory` callable instead. Kept typed for older callers.
   */
  story?: string;
  /**
   * The review screen's OPTIONAL likeness/promotion checkbox, exactly as the
   * user left it. Always sent by 2.9+ clients; typed optional so payloads
   * built elsewhere stay valid while the backend adds storage in parallel.
   */
  promoConsentGranted?: boolean;
}

export interface SubmitPrizeClaimResponse {
  claimNumber: string;
  /** ISO date */
  submittedAt: string;
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
  /** Monthly milestone if achieved */
  monthlyMilestone?: MilestoneAward;
  /** Weekly / monthly bonus progress + lifetime count after this claim */
  weeklyCurrent?: number;
  monthlyCurrent?: number;
  lifetimeCount?: number;
}

export interface SubmitEmailRequest {
  email: string;
  /**
   * The capture screen's age-gate checkbox ("I confirm I am 18 years of age or
   * older"), as the user left it. Stored server-side, and the flag the backend
   * keys off to detect a 2.4.0+ client — always sent.
   */
  ageConfirmed?: boolean;
  /**
   * The capture screen's MARKETING-consent checkbox — pre-checked, and
   * unchecking it does NOT block entry. Marketing email only: winner contact
   * is unaffected.
   */
  marketingConsent?: boolean;
  publisherUserId?: string;
}

export interface SubmitEmailResponse {
  success: boolean;
  /**
   * When the email matched an existing account under this publisher (another
   * device/SDK), the backend adopts that canonical user so the streak follows the
   * person across devices. If `adopted` is true, the SDK switches to these
   * credentials. Absent on a normal first-time submit.
   */
  adopted?: boolean;
  uuid?: string;
  token?: string;
  refreshToken?: string;
  /**
   * Soft email-verification signal for the address just submitted (see
   * {@link RegisterDeviceResponse.emailVerified}). `false` means the user
   * typed a brand-new, unconfirmed email → show the verify chip. Absent for
   * verified/partner/adoption users.
   */
  emailVerified?: boolean;
  /** True when this submit triggered a verification email to be sent. */
  emailVerificationSent?: boolean;
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
    /** Brand accent — drives CTAs, the active streak tile, highlights. Comes from
     * branding.primaryColor (publisher/admin config), not text. */
    accent: string;
    /** Secondary brand accent — drives the radial glow. From branding.secondaryColor. */
    accentGlow: string;
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

/**
 * Options for the SDK-internal presentation flow (auto-open). Not part of the
 * public API — the experience cannot be launched manually.
 */
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
  SDK_VERSION: '2.9.0',
  PLATFORM_OS: 'Web',
  getApiBaseUrl: (_environment: 'production' = 'production'): string => {
    return 'https://us-central1-winr-9c11f.cloudfunctions.net';
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
    // Auto-present persistence (suffixed with the bundleId at the call site so
    // multiple publisher integrations on one origin don't cross-contaminate).
    LAST_AUTO_PRESENT: 'winr_last_auto_present',
    GUEST_ID: 'winr_guest_id',
    UNREGISTERED_IMPRESSIONS: 'winr_unregistered_impressions',
    OPTED_OUT: 'winr_opted_out',
  },
  DEFAULT_MILESTONES: [
    { day: 5, bonusEntries: 10 },
    { day: 15, bonusEntries: 50, badge: 'silver' },
    { day: 25, bonusEntries: 200, badge: 'gold' },
  ] as MilestoneConfig[],
} as const;
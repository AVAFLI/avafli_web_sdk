/**
 * WINR Web SDK - Main Entry Point
 * 
 * Export all public APIs and types
 */

// Main SDK class
export { WINR } from './winr';

// Core types and interfaces
export type {
  WINRConfiguration,
  WINROptions,
  WINRBranding,
  WINRUser,
  StreakState,
  MilestoneConfig,
  MilestoneAward,
  Giveaway,
  AdConfig,
  DailyEntryGrant,
  GiveawayWinner,
  ExperienceConfig,
  PresentationOptions,
  Theme,
  StorageProvider,
  AnalyticsAdapter,
  Logger,
  SDKConfig,
} from './types';

// Error handling
export { WINRError, WINRErrorCode } from './types';

// Domain classes (for advanced usage)
export { StreakEngine } from './domain/streak-engine';

// Service adapters (for custom implementations)
export { AnalyticsAdapter as AnalyticsAdapterInterface } from './types';

// Constants
export { WINR_CONSTANTS } from './types';

// Storage providers (for custom storage)
export { LocalStorageProvider } from './storage/local-storage';
export { SessionStorageProvider } from './storage/session-storage';

// Network client (for advanced usage)
export { NetworkClient } from './network/client';

// UI Theme utilities
export { createTheme } from './ui/theme';

// Default export for UMD builds
import { WINR } from './winr';
export default WINR;
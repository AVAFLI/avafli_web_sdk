/**
 * Avafli Web SDK - Main Entry Point
 * 
 * Export all public APIs and types
 */

// Main SDK class
export { Avafli } from './avafli';

// Core types and interfaces
export type {
  AvafliConfiguration,
  AvafliOptions,
  AvafliBranding,
  AvafliUser,
  StreakState,
  MilestoneConfig,
  MilestoneAward,
  Giveaway,
  AdConfig,
  DailyEntryGrant,
  GiveawayWinner,
  ExperienceConfig,
  Theme,
  StorageProvider,
  AnalyticsAdapter,
  Logger,
  SDKConfig,
} from './types';

// Error handling
export { AvafliError, AvafliErrorCode } from './types';

// Domain classes (for advanced usage)
export { StreakEngine } from './domain/streak-engine';

// Service adapters (for custom implementations)
export { AnalyticsAdapter as AnalyticsAdapterInterface } from './types';

// Constants
export { AVAFLI_CONSTANTS } from './types';

// Storage providers (for custom storage)
export { LocalStorageProvider } from './storage/local-storage';
export { SessionStorageProvider } from './storage/session-storage';

// Network client (for advanced usage)
export { NetworkClient } from './network/client';

// UI Theme utilities
export { createTheme } from './ui/theme';

// Default export for UMD builds
import { Avafli } from './avafli';
export default Avafli;
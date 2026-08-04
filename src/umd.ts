/**
 * UMD entry point.
 *
 * The ESM build (src/index.ts) uses named exports for bundler/TS consumers. For the
 * browser <script> build we want the global `WINR` to BE the class, so the documented
 * `WINR.configure(...)` works verbatim. The other runtime exports are attached as
 * properties (e.g. `WINR.WINRError`, `WINR.StreakEngine`), and `WINR.WINR`
 * self-references the class for backward compatibility.
 */
import { WINR } from './winr';
import { WINRError, WINRErrorCode, WINR_CONSTANTS } from './types';
import { StreakEngine } from './domain/streak-engine';
import { LocalStorageProvider } from './storage/local-storage';
import { SessionStorageProvider } from './storage/session-storage';
import { NetworkClient } from './network/client';
import { createTheme } from './ui/theme';

Object.assign(WINR as unknown as Record<string, unknown>, {
  WINR,
  default: WINR,
  WINRError,
  WINRErrorCode,
  WINR_CONSTANTS,
  StreakEngine,
  LocalStorageProvider,
  SessionStorageProvider,
  NetworkClient,
  createTheme,
});

export default WINR;

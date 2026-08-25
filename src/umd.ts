/**
 * UMD entry point.
 *
 * The ESM build (src/index.ts) uses named exports for bundler/TS consumers. For the
 * browser <script> build we want the global `Avafli` to BE the class, so the documented
 * `Avafli.configure(...)` works verbatim. The other runtime exports are attached as
 * properties (e.g. `Avafli.AvafliError`, `Avafli.StreakEngine`), and `Avafli.Avafli`
 * self-references the class for backward compatibility.
 */
import { Avafli } from './avafli';
import { AvafliError, AvafliErrorCode, AVAFLI_CONSTANTS } from './types';
import { StreakEngine } from './domain/streak-engine';
import { LocalStorageProvider } from './storage/local-storage';
import { SessionStorageProvider } from './storage/session-storage';
import { NetworkClient } from './network/client';
import { createTheme } from './ui/theme';

Object.assign(Avafli as unknown as Record<string, unknown>, {
  Avafli,
  default: Avafli,
  AvafliError,
  AvafliErrorCode,
  AVAFLI_CONSTANTS,
  StreakEngine,
  LocalStorageProvider,
  SessionStorageProvider,
  NetworkClient,
  createTheme,
});

export default Avafli;

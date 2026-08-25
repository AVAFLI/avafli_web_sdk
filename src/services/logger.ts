import { Logger } from '../types';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Silent = 4,
}

/**
 * Avafli SDK Logger with configurable levels and formatting
 */
export class AvafliLogger implements Logger {
  private level: LogLevel = LogLevel.Warn;
  private prefix = '[Avafli]';

  constructor(level: LogLevel = LogLevel.Warn) {
    this.level = level;
  }

  /**
   * Set logging level
   */
  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current logging level
   */
  public getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Check if a log level is enabled
   */
  public isEnabled(level: LogLevel): boolean {
    return this.level <= level;
  }

  /**
   * Log debug message
   */
  public debug(message: string, ...args: unknown[]): void {
    if (this.isEnabled(LogLevel.Debug)) {
      this.log('debug', message, ...args);
    }
  }

  /**
   * Log info message
   */
  public info(message: string, ...args: unknown[]): void {
    if (this.isEnabled(LogLevel.Info)) {
      this.log('info', message, ...args);
    }
  }

  /**
   * Log warning message
   */
  public warn(message: string, ...args: unknown[]): void {
    if (this.isEnabled(LogLevel.Warn)) {
      this.log('warn', message, ...args);
    }
  }

  /**
   * Log error message
   */
  public error(message: string, ...args: unknown[]): void {
    if (this.isEnabled(LogLevel.Error)) {
      this.log('error', message, ...args);
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formattedMessage = `${this.prefix} ${timestamp} [${level.toUpperCase()}] ${message}`;

    try {
      switch (level) {
        case 'debug':
        case 'info':
          console.log(formattedMessage, ...args);
          break;
        case 'warn':
          console.warn(formattedMessage, ...args);
          break;
        case 'error':
          console.error(formattedMessage, ...args);
          break;
      }
    } catch {
      // Fallback if console methods are not available
      try {
        console.log(formattedMessage, ...args);
      } catch {
        // Complete fallback - do nothing if console is not available
      }
    }
  }

  /**
   * Create a child logger with additional context
   */
  public child(context: string): AvafliLogger {
    const childLogger = new AvafliLogger(this.level);
    childLogger.prefix = `${this.prefix}[${context}]`;
    return childLogger;
  }

  /**
   * Log an error with stack trace
   */
  public logError(error: Error, context?: string): void {
    const contextStr = context ? ` (${context})` : '';
    this.error(`${error.message}${contextStr}`, {
      name: error.name,
      stack: error.stack,
      cause: error.cause,
    });
  }

  /**
   * Log performance timing
   */
  public logTiming(operation: string, startTime: number): void {
    const duration = Date.now() - startTime;
    this.debug(`${operation} completed in ${duration}ms`);
  }

  /**
   * Create a logger from debug flag
   */
  public static fromDebug(debug: boolean): AvafliLogger {
    return new AvafliLogger(debug ? LogLevel.Debug : LogLevel.Warn);
  }

  /**
   * Create a logger from environment
   */
  public static fromEnvironment(): AvafliLogger {
    try {
      // Determine whether we are in a development build. NOTE: nothing replaces
      // process.env.NODE_ENV at build time (no @rollup/plugin-replace) — this is a
      // RUNTIME check, and in browsers `process` is undefined, so shipped bundles
      // always take the production path. Do not "optimize" this away.
      const isDevBuild =
        typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'development';

      // Verbose logging via URL/localStorage flags is ONLY honored in dev builds.
      // In production this prevents end-users from trivially enabling debug
      // logging (and potential PII leakage) via a query param.
      if (isDevBuild && typeof window !== 'undefined') {
        // `avafli_debug` (3.0) — `winr_debug` still honored for muscle memory.
        const params = new URLSearchParams(window.location.search);
        if (params.get('avafli_debug') === 'true' || params.get('winr_debug') === 'true') {
          return new AvafliLogger(LogLevel.Debug);
        }

        // Check localStorage for debug setting
        if (
          window.localStorage?.getItem('avafli_debug') === 'true' ||
          window.localStorage?.getItem('winr_debug') === 'true'
        ) {
          return new AvafliLogger(LogLevel.Debug);
        }
      }

      // Dev builds default to verbose logging.
      if (isDevBuild) {
        return new AvafliLogger(LogLevel.Debug);
      }
    } catch {
      // Ignore errors accessing environment variables
    }

    return new AvafliLogger(LogLevel.Warn);
  }
}

// Export singleton instance
export const logger = AvafliLogger.fromEnvironment();
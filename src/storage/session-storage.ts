import { StorageProvider } from '../types';

/**
 * sessionStorage wrapper for sensitive data that should not persist across sessions
 * Used for auth tokens and refresh tokens
 */
export class SessionStorageProvider implements StorageProvider {
  private isAvailable: boolean = false;

  constructor() {
    this.isAvailable = this.checkAvailability();
  }

  public getItem(key: string): string | null {
    if (!this.isAvailable) return null;
    
    try {
      return sessionStorage.getItem(key);
    } catch (error) {
      console.warn(`SessionStorage getItem failed for key "${key}":`, error);
      return null;
    }
  }

  public setItem(key: string, value: string): void {
    if (!this.isAvailable) return;
    
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      console.warn(`SessionStorage setItem failed for key "${key}":`, error);
      
      // Try to clear some space if quota exceeded
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        this.cleanup();
        try {
          sessionStorage.setItem(key, value);
        } catch (retryError) {
          console.error(`SessionStorage setItem retry failed for key "${key}":`, retryError);
        }
      }
    }
  }

  public removeItem(key: string): void {
    if (!this.isAvailable) return;
    
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.warn(`SessionStorage removeItem failed for key "${key}":`, error);
    }
  }

  public clear(): void {
    if (!this.isAvailable) return;
    
    try {
      // Only clear Avafli-related keys to avoid affecting other apps
      this.clearSdkKeys();
    } catch (error) {
      console.warn('SessionStorage clear failed:', error);
    }
  }

  private checkAvailability(): boolean {
    try {
      if (typeof window === 'undefined' || !window.sessionStorage) {
        return false;
      }

      // Test sessionStorage functionality
      const testKey = '__avafli_session_test__';
      const testValue = 'test';
      
      window.sessionStorage.setItem(testKey, testValue);
      const retrieved = window.sessionStorage.getItem(testKey);
      window.sessionStorage.removeItem(testKey);
      
      return retrieved === testValue;
    } catch {
      return false;
    }
  }

  private clearSdkKeys(): void {
    const keys = [];
    
    // Collect all Avafli-related keys. Persisted SDK keys deliberately KEEP
    // the legacy `winr_` prefix (3.0 rebrand did not migrate stored state);
    // `avafli_` covers anything minted under the new prefix.
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('winr_') || key?.startsWith('avafli_')) {
        keys.push(key);
      }
    }
    
    // Remove Avafli keys
    keys.forEach(key => sessionStorage.removeItem(key));
  }

  private cleanup(): void {
    try {
      // Remove any non-essential session data to free up space
      const nonEssentialKeys = [];
      
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if ((key?.startsWith('winr_') || key?.startsWith('avafli_')) && !this.isEssentialKey(key)) {
          nonEssentialKeys.push(key);
        }
      }
      
      // Remove non-essential keys
      nonEssentialKeys.forEach(key => sessionStorage.removeItem(key));
    } catch (error) {
      console.warn('SessionStorage cleanup failed:', error);
    }
  }

  private isEssentialKey(key: string): boolean {
    // Essential keys that should not be removed during cleanup
    const essentialKeys = [
      'winr_token',
      'winr_refresh_token',
      'winr_uuid',
    ];
    
    return essentialKeys.includes(key);
  }

  /**
   * Check if session storage is in incognito/private mode
   * Some browsers have reduced storage capacity in private mode
   */
  public isPrivateMode(): boolean {
    if (!this.isAvailable) return false;
    
    try {
      // Test with a larger string to detect private mode limitations
      const testData = new Array(1000).join('a'); // ~1KB
      const testKey = '__avafli_private_test__';
      
      sessionStorage.setItem(testKey, testData);
      sessionStorage.removeItem(testKey);
      
      return false; // If successful, probably not private mode
    } catch {
      return true; // If failed, might be private mode or storage full
    }
  }

  /**
   * Get available storage space estimation
   */
  public getAvailableSpace(): number {
    if (!this.isAvailable) return 0;
    
    try {
      const testString = 'a';
      let space = 0;
      
      while (space < 5 * 1024 * 1024) { // Test up to 5MB
        try {
          const testKey = `__avafli_space_test__`;
          const testData = new Array(space + 1024).join(testString); // 1KB increments
          sessionStorage.setItem(testKey, testData);
          sessionStorage.removeItem(testKey);
          space += 1024;
        } catch {
          break;
        }
      }
      
      return space;
    } catch {
      return 0;
    }
  }
}

// Export singleton instance
export const sessionStorageProvider = new SessionStorageProvider();
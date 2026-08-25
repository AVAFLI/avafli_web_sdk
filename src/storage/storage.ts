import { StorageProvider } from '../types';

/**
 * Base storage interface
 */
export interface Storage {
  get<T = string>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  clear(): void;
}

/**
 * Storage adapter that wraps any StorageProvider
 */
export class StorageAdapter implements Storage {
  constructor(private provider: StorageProvider) {}

  public get<T = string>(key: string): T | null {
    try {
      const value = this.provider.getItem(key);
      if (value === null) return null;
      
      // Try to parse as JSON, fall back to string
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch {
      return null;
    }
  }

  public set(key: string, value: unknown): void {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      this.provider.setItem(key, serialized);
    } catch (error) {
      console.warn(`Failed to store value for key "${key}":`, error);
    }
  }

  public remove(key: string): void {
    try {
      this.provider.removeItem(key);
    } catch (error) {
      console.warn(`Failed to remove key "${key}":`, error);
    }
  }

  public clear(): void {
    try {
      this.provider.clear();
    } catch (error) {
      console.warn('Failed to clear storage:', error);
    }
  }
}

/**
 * Memory-based storage for fallback
 */
export class MemoryStorage implements StorageProvider {
  private data = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.data.get(key) || null;
  }

  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  public removeItem(key: string): void {
    this.data.delete(key);
  }

  public clear(): void {
    this.data.clear();
  }
}

/**
 * Create storage adapter with fallback
 */
export function createStorage(provider?: StorageProvider): Storage {
  if (provider) {
    return new StorageAdapter(provider);
  }

  // Try localStorage first
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Test storage to ensure it's working
      const testKey = '__avafli_test__';
      window.localStorage.setItem(testKey, 'test');
      window.localStorage.removeItem(testKey);
      return new StorageAdapter(window.localStorage);
    }
  } catch {
    // localStorage is not available or failed
  }

  // Fallback to memory storage
  console.warn('Avafli: localStorage not available, using memory storage (data will not persist)');
  return new StorageAdapter(new MemoryStorage());
}
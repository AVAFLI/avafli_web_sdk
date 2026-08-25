import { logger } from './logger';

/**
 * Web Push Notification manager for Avafli SDK
 */
export class PushNotificationManager {
  private registration: ServiceWorkerRegistration | null = null;
  private vapidPublicKey: string | null = null;
  private isInitialized: boolean = false;

  /**
   * Initialize push notifications with VAPID public key
   */
  public async initialize(vapidPublicKey: string): Promise<boolean> {
    if (this.isInitialized) return true;

    this.vapidPublicKey = vapidPublicKey;

    try {
      // Check if service workers are supported
      if (!('serviceWorker' in navigator)) {
        logger.warn('Service workers not supported');
        return false;
      }

      // Check if push messaging is supported
      if (!('PushManager' in window)) {
        logger.warn('Push messaging not supported');
        return false;
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      logger.error('Push notification initialization failed:', error);
      return false;
    }
  }

  /**
   * Request notification permission from the user
   */
  public async requestPermission(): Promise<NotificationPermission> {
    try {
      if (!('Notification' in window)) {
        logger.warn('Notifications not supported');
        return 'denied';
      }

      const permission = await Notification.requestPermission();
      logger.debug(`Notification permission: ${permission}`);
      return permission;
    } catch (error) {
      logger.error('Failed to request notification permission:', error);
      return 'denied';
    }
  }

  /**
   * Get current notification permission status
   */
  public getPermissionStatus(): NotificationPermission {
    if (!('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  /**
   * Register service worker for push notifications
   */
  public async registerServiceWorker(serviceWorkerPath: string = '/sw.js'): Promise<boolean> {
    try {
      if (!('serviceWorker' in navigator)) {
        return false;
      }

      this.registration = await navigator.serviceWorker.register(serviceWorkerPath);
      logger.debug('Service worker registered successfully');

      // Wait for service worker to be active
      await this.waitForServiceWorker();
      return true;
    } catch (error) {
      logger.error('Service worker registration failed:', error);
      return false;
    }
  }

  /**
   * Subscribe to push notifications and get push subscription
   */
  public async subscribe(): Promise<PushSubscription | null> {
    try {
      if (!this.registration || !this.vapidPublicKey) {
        logger.error('Service worker or VAPID key not configured');
        return null;
      }

      // Check if already subscribed
      let subscription = await this.registration.pushManager.getSubscription();
      
      if (!subscription) {
        // Create new subscription
        subscription = await this.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey) as BufferSource,
        });
      }

      logger.debug('Push subscription created:', subscription);
      return subscription;
    } catch (error) {
      logger.error('Failed to subscribe to push notifications:', error);
      return null;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  public async unsubscribe(): Promise<boolean> {
    try {
      if (!this.registration) {
        return true; // Already unsubscribed
      }

      const subscription = await this.registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        logger.debug('Unsubscribed from push notifications');
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to unsubscribe from push notifications:', error);
      return false;
    }
  }

  /**
   * Get current push subscription
   */
  public async getCurrentSubscription(): Promise<PushSubscription | null> {
    try {
      if (!this.registration) {
        return null;
      }

      return await this.registration.pushManager.getSubscription();
    } catch (error) {
      logger.error('Failed to get current subscription:', error);
      return null;
    }
  }

  /**
   * Show a local notification (for testing)
   */
  public async showNotification(
    title: string,
    options?: NotificationOptions
  ): Promise<boolean> {
    try {
      if (this.getPermissionStatus() !== 'granted') {
        logger.warn('Notification permission not granted');
        return false;
      }

      if (this.registration) {
        // Use service worker to show notification
        await this.registration.showNotification(title, {
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          tag: 'avafli-notification',
          // renotify: true, // Non-standard property
          requireInteraction: false,
          ...options,
        });
      } else {
        // Fallback to regular notification
        new Notification(title, {
          icon: '/icon-192.png',
          tag: 'avafli-notification',
          ...options,
        });
      }

      return true;
    } catch (error) {
      logger.error('Failed to show notification:', error);
      return false;
    }
  }

  /**
   * Check if push notifications are supported and permission is granted
   */
  public isSupported(): boolean {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /**
   * Check if fully configured and ready
   */
  public isReady(): boolean {
    return this.isInitialized && this.isSupported() && this.getPermissionStatus() === 'granted';
  }

  /**
   * Get push subscription for server registration
   */
  public async getSubscriptionData(): Promise<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
  } | null> {
    try {
      const subscription = await this.getCurrentSubscription();
      if (!subscription) return null;

      const keys = subscription.getKey ? {
        p256dh: this.arrayBufferToBase64(subscription.getKey('p256dh')),
        auth: this.arrayBufferToBase64(subscription.getKey('auth')),
      } : { p256dh: '', auth: '' };

      return {
        endpoint: subscription.endpoint,
        keys,
      };
    } catch (error) {
      logger.error('Failed to get subscription data:', error);
      return null;
    }
  }

  private async waitForServiceWorker(): Promise<void> {
    if (!this.registration) return;

    return new Promise((resolve) => {
      if (this.registration!.active) {
        resolve();
        return;
      }

      const worker = this.registration!.installing || this.registration!.waiting;
      if (worker) {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | null): string {
    if (!buffer) return '';
    
    const bytes = new Uint8Array(buffer);
    const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
    return window.btoa(binary);
  }
}

// Export singleton instance
export const pushNotificationManager = new PushNotificationManager();
<p align="center">
  <strong>WINR Web SDK</strong><br />
  <em>Sweepstakes &amp; gamification for the web — by <a href="https://avafli.com">Avafli</a></em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/winr-web-sdk"><img src="https://img.shields.io/npm/v/winr-web-sdk.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/winr-web-sdk"><img src="https://img.shields.io/npm/dm/winr-web-sdk.svg" alt="npm downloads" /></a>
  <a href="https://github.com/winr-sdk/winr-web-sdk/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/winr-web-sdk.svg" alt="license" /></a>
</p>

---

Drop-in sweepstakes, daily streaks, and prizing experiences for any website. WINR handles the full engagement lifecycle — UI, email capture, streak tracking, entries, bonus rewards, and compliance — so you can focus on your product.

- **Zero dependencies** — a single lightweight bundle with nothing to conflict
- **Shadow DOM isolation** — styles never leak into (or out of) your page
- **Server-driven UI** — branding, copy, and assets are managed from the [WINR dashboard](https://avafli.com); no client-side theming required
- **ESM + UMD** — works with every bundler, or straight from a CDN

## Installation

### npm / yarn / pnpm

```bash
npm install winr-web-sdk
```

```bash
yarn add winr-web-sdk
```

```bash
pnpm add winr-web-sdk
```

### CDN (UMD)

```html
<script src="https://unpkg.com/winr-web-sdk@latest/dist/winr-sdk.umd.js"></script>
```

The UMD build exposes a global `WINR` object on `window`.

## Quick start

### ES Modules

```typescript
import { WINR } from 'winr-web-sdk';

// 1. Configure with user
await WINR.configure({
  apiKey: 'YOUR_API_KEY',
  bundleId: 'com.example.myapp',
  user: {
    id: 'user_123',
    firstName: 'Jane',
    lastName: 'Doe',
  },
});

// 2. Present the experience
WINR.present();
```

### UMD / Script tag

```html
<script src="https://unpkg.com/winr-web-sdk@latest/dist/winr-sdk.umd.js"></script>
<script>
  (async function () {
    await WINR.configure({
      apiKey: 'YOUR_API_KEY',
      bundleId: 'com.example.myapp',
      user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' },
    });

    await WINR.present();
  })();
</script>
```

### Inline (embedded in a container)

```html
<div id="winr-container" style="width: 100%; max-width: 480px;"></div>

<script type="module">
  import { WINR } from 'winr-web-sdk';

  await WINR.configure({
    apiKey: 'YOUR_API_KEY',
    bundleId: 'com.example.myapp',
    user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' },
  });

  await WINR.presentInline('winr-container', {
    onComplete: (result) => {
      console.log(`Streak day ${result.streakDay}: ${result.entries} entries`);
    },
  });
</script>
```

## API Reference

### `WINR.configure(config)`

Initialize the SDK and identify the user. Call once before any other method.

```typescript
await WINR.configure({
  apiKey: string;            // Required — your publisher API key
  bundleId: string;          // Required — your app/site identifier
  user: {                    // Required — current user
    id: string;              // Stable unique user ID
    firstName: string;       // User's first name
    lastName: string;        // User's last name
    phone?: string;          // Phone number (optional)
  };
  options?: {
    environment?: 'production' | 'staging' | 'qa';   // Default: 'production'
    debug?: boolean;                                   // Enable verbose logging
    rewardedVideoProvider?: RewardedVideoProvider;     // Custom video ad provider
    analyticsAdapter?: AnalyticsAdapter;               // Custom analytics adapter
    deviceFingerprintProvider?: () => Promise<string>; // Custom fingerprint function
  };
});
```

The SDK automatically submits the user profile and identifies the user in analytics during configuration.

> **Note:** Email is captured directly by the SDK's built-in UI. Publishers do not need to collect or pass email addresses.

### `WINR.present(options?)`

Open the WINR experience as a full-screen modal overlay.

```typescript
await WINR.present({
  onComplete?: (result: DailyEntryGrant) => void;  // Fires after a successful claim
  onClose?: () => void;                              // Fires when the user dismisses
  onError?: (error: WINRError) => void;              // Fires on error
});
```

### `WINR.presentInline(containerId, options?)`

Embed the experience inside an existing DOM element.

```typescript
await WINR.presentInline('my-container', {
  onComplete?: (result: DailyEntryGrant) => void;
  onClose?: () => void;
  onError?: (error: WINRError) => void;
});
```

### `WINR.dismiss()`

Programmatically close the WINR experience.

```typescript
WINR.dismiss();
```

### `WINR.refreshConfig()`

Re-fetch server configuration (branding, copy, active giveaway). Useful after a user changes locale or when long-lived pages need fresh data.

```typescript
await WINR.refreshConfig();
```

### `WINR.deleteUserData()`

Delete all stored user data and reset local state. Supports GDPR/CCPA right-to-erasure workflows.

```typescript
await WINR.deleteUserData();
```

## Callback types

### `DailyEntryGrant`

Returned in the `onComplete` callback:

```typescript
interface DailyEntryGrant {
  entries: number;                  // Base entries granted
  streakDay: number;                // Current streak day (1–6)
  totalEntries: number;             // Lifetime total entries
  weeklyBonusEntries?: number;      // Weekly bonus (if awarded)
  monthlyBonusEntries?: number;     // Monthly bonus (if awarded)
  milestone?: {
    day: number;
    bonusEntries: number;
    badge?: string;
  };
}
```

### `WINRError`

```typescript
class WINRError extends Error {
  code: WINRErrorCode;
  originalError?: Error;
}

enum WINRErrorCode {
  NotConfigured            // SDK not configured
  InvalidState             // Unexpected SDK state
  NetworkError             // Network request failed
  GiveawayNotActive        // No active giveaway
  IneligibleToday          // Already claimed today
  RewardedVideoUnavailable // Video ad failed to load
  InvalidConfiguration     // Bad config values
}
```

## Rewarded video provider

WINR supports bonus entries earned by watching a rewarded video. Supply your own ad provider by implementing the `RewardedVideoProvider` interface:

```typescript
import { WINR, RewardedVideoProvider } from 'winr-web-sdk';

class MyAdProvider implements RewardedVideoProvider {
  async isAvailable(): Promise<boolean> { /* … */ }
  async load(): Promise<void> { /* … */ }
  async show(): Promise<{ success: boolean; reward?: { type: string; amount: number } }> { /* … */ }
}

await WINR.configure({
  apiKey: 'YOUR_API_KEY',
  bundleId: 'com.example.myapp',
  user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' },
  options: {
    rewardedVideoProvider: new MyAdProvider(),
  },
});
```

If no provider is supplied, the bonus-entry step is skipped automatically.

## Analytics adapter

Pipe SDK events into your existing analytics stack:

```typescript
import { WINR, AnalyticsAdapter } from 'winr-web-sdk';

const analytics: AnalyticsAdapter = {
  track(event, properties) { /* e.g. segment.track(event, properties) */ },
  identify(userId, traits) { /* e.g. segment.identify(userId, traits) */ },
};

await WINR.configure({
  apiKey: 'YOUR_API_KEY',
  bundleId: 'com.example.myapp',
  user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' },
  options: { analyticsAdapter: analytics },
});
```

## Shadow DOM isolation

All WINR UI is rendered inside a [Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM) boundary. This means:

- WINR styles **cannot** affect your host page
- Your global CSS **cannot** break WINR's UI
- No `!important` hacks, no class-name collisions, no z-index wars

## GDPR & privacy

| Concern | How WINR handles it |
|---|---|
| **Right to erasure** | `WINR.deleteUserData()` clears all local and server-side data |
| **Email consent** | Managed by the SDK's built-in consent UI |
| **Data minimization** | Only the data required to run the experience is collected |
| **No third-party tracking** | Zero dependencies — no hidden trackers ship with the SDK |

## Browser support

| Browser | Minimum version |
|---|---|
| Chrome | 80+ |
| Firefox | 78+ |
| Safari | 14+ |
| Edge | 80+ |

The SDK uses Shadow DOM and modern ES features. Internet Explorer is **not** supported.

## TypeScript

Full type definitions ship with the package — no `@types` install needed.

```typescript
import { WINR, WINRConfiguration, WINRUser, PresentationOptions, DailyEntryGrant, WINRError } from 'winr-web-sdk';
```

## License

[MIT](./LICENSE)

---

Built by [Avafli](https://avafli.com)

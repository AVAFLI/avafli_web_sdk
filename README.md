# WINR Web SDK
**Drop-in sweepstakes, prizing, and gamification for your web application**

[![npm](https://img.shields.io/npm/v/winr-web-sdk.svg)](https://www.npmjs.com/package/winr-web-sdk)
[![npm downloads](https://img.shields.io/npm/dm/winr-web-sdk.svg)](https://www.npmjs.com/package/winr-web-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/npm/l/winr-web-sdk.svg)](https://github.com/avafli/winr-web-sdk/blob/main/LICENSE)

---

## Overview

WINR lets you add daily-entry sweepstakes and prize experiences to your app in under 20 lines of code. The entire UI — branding, theming, copy, and prize configuration — is managed server-side from the WINR dashboard. You integrate once; your marketing team controls the rest.

**Key capabilities:**
- **Daily entry sweepstakes** — Users earn entries every day they engage
- **Bonus entries via rewarded video** — Monetize attention with opt-in ads
- **Server-driven UI** — Branding, prizes, and copy update without app releases
- **GDPR/CCPA compliant** — Built-in consent flows and user data deletion
- **Analytics forwarding** — Route SDK events to your existing analytics stack
- **Shadow DOM isolation** — Styles never leak into your page

## Quick Start

### ES Modules

```typescript
import { WINR } from 'winr-web-sdk';

// 1. Configure the SDK
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
await WINR.present();
```

### CDN (UMD)

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

### CDN

```html
<script src="https://unpkg.com/winr-web-sdk@latest/dist/winr-sdk.umd.js"></script>
```

> **Note:** Contact [AVAFLI](https://avafli-website.web.app/sdk/pricing) to obtain an API key.

## Configuration

Initialize the SDK with your user and environment settings:

```typescript
await WINR.configure({
  apiKey: 'winr_live_xxxxxxxxxx',
  bundleId: 'com.example.myapp',
  user: {
    id: 'user_abc123',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '+15551234567',  // optional
  },
  options: {
    environment: 'production',
    debug: false,
    analyticsAdapter: myAdapter,
  },
});
```

### Configuration Options

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `apiKey` | `string` | ✅ | Your WINR API key from the dashboard |
| `bundleId` | `string` | ✅ | App bundle ID (e.g., com.example.myapp) |
| `user` | `WINRUser` | ✅ | The authenticated user |
| `options` | `WINROptions?` | — | Optional behavior toggles |

### WINRUser

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `id` | `string` | ✅ | Unique, stable user identifier |
| `firstName` | `string` | ✅ | User's first name |
| `lastName` | `string` | ✅ | User's last name |
| `phone` | `string?` | — | Phone number in E.164 format |

> **Email:** The SDK captures email through its own opt-in UI. Do not pass email via `WINRUser`.

## Present the Experience

### Full-screen Modal

Launch the full-screen WINR experience as a modal overlay:

```typescript
await WINR.present({
  onComplete: (result: DailyEntryGrant) => {
    console.log(`Streak day ${result.streakDay}: ${result.entries} entries`);
  },
  onClose: () => {
    console.log('User closed the experience');
  },
  onError: (error: WINRError) => {
    console.error('WINR error:', error);
  },
});
```

### Inline Embed

Embed the experience inside an existing DOM element:

```html
<div id="winr-container" style="width: 100%; max-width: 480px;"></div>

<script type="module">
  await WINR.presentInline('winr-container', {
    onComplete: (result) => {
      console.log(`You earned ${result.entries} entries!`);
    },
  });
</script>
```

## Push Notifications

For web applications, push notifications are not applicable. The SDK focuses on in-app engagement and retention through the sweepstakes experience itself.

## Customization

All branding, themes, and copy are managed server-side through the [WINR Dashboard](https://avafli-website.web.app/sdk/dashboard):

- **Colors & Branding** — Primary colors, logos, backgrounds
- **Copy & Messaging** — Headlines, CTAs, legal text
- **Prize Configuration** — Active giveaways, entry mechanics

Changes apply instantly across all web applications without requiring a deployment.

## Analytics

Forward WINR events to your existing analytics stack:

```typescript
import { WINR, AnalyticsAdapter } from 'winr-web-sdk';

const analytics: AnalyticsAdapter = {
  track(event, properties) { 
    // Forward to Segment, Amplitude, etc.
    segment.track(event, properties); 
  },
  identify(userId, traits) { 
    segment.identify(userId, traits); 
  },
};

await WINR.configure({
  apiKey: 'YOUR_API_KEY',
  bundleId: 'com.example.myapp',
  user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' },
  options: { analyticsAdapter: analytics },
});
```

**Events emitted by the SDK:**
- `winr.session_started` — User opened the WINR experience
- `winr.entry_granted` — Daily entries awarded
- `winr.bonus_entry_granted` — Bonus entries earned via rewarded video
- `winr.session_completed` — User closed the WINR experience

## GDPR / Delete User Data

Support GDPR/CCPA deletion requests:

```typescript
await WINR.deleteUserData();
```

This permanently removes all user data, entries, preferences, and consent records from WINR servers.

## API Reference

### Core Methods

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `WINR.configure(config)` | `Promise<void>` | Initialize the SDK with user and settings |
| `WINR.present(options?)` | `Promise<void>` | Launch the full-screen WINR experience |
| `WINR.presentInline(containerId, options?)` | `Promise<void>` | Embed the experience in a container |
| `WINR.dismiss()` | `void` | Programmatically close the experience |
| `WINR.deleteUserData()` | `Promise<void>` | Permanently delete all user data |

### Callback Types

#### DailyEntryGrant

```typescript
interface DailyEntryGrant {
  entries: number;                  // Base entries granted
  streakDay: number;                // Current streak day (1–6)
  totalEntries: number;             // Lifetime total entries
  weeklyBonusEntries?: number;      // Weekly bonus (if awarded)
  monthlyBonusEntries?: number;     // Monthly bonus (if awarded)
}
```

For detailed API documentation, see the [WINR Docs](https://avafli-website.web.app/sdk/web).

## Links

- **Dashboard:** [https://avafli-website.web.app/sdk/dashboard](https://avafli-website.web.app/sdk/dashboard)
- **Documentation:** [https://avafli-website.web.app/sdk/web](https://avafli-website.web.app/sdk/web)
- **Support:** [info@avafli.com](mailto:info@avafli.com)

---

© 2026 Avafli. All Rights Reserved.
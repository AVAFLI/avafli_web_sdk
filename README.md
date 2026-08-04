# WINR Web SDK
**Drop-in sweepstakes, prizing, and gamification for your web application**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/AVAFLI/winr_web_sdk/blob/main/LICENSE)

---

## Overview

WINR lets you add daily-entry sweepstakes and prize experiences to your app in under 20 lines of code. The entire UI — branding, theming, copy, and prize configuration — is managed server-side from the WINR dashboard. You integrate once; your marketing team controls the rest.

**Key capabilities:**
- **Daily entry sweepstakes** — Users earn entries every day they engage
- **Auto-open experience** — Opens automatically on the first visit of each day; entries are granted automatically the moment it opens
- **Day 2+ reveal** — Returning users see yesterday's numbers behind a "CLAIM {n} ENTRIES" button; the click is the celebration (tile check-off, confetti, totals count up) — no modal. Day 1 keeps the "You're in!" celebration modal
- **Responsive V2 design** — Bottom drawer on mobile (<768px), centered modal card on desktop (≥768px)
- **Publisher branding** — Logo, primary color, and prize image configured from the WINR dashboard
- **GDPR/CCPA compliant** — Built-in consent flows and user data deletion
- **Analytics forwarding** — Route SDK events to your existing analytics stack
- **Shadow DOM isolation** — Styles never leak into your page; fonts and imagery are bundled (no CDN fetches)

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

// 2. That's it — the experience presents itself on the first visit of
//    each day. There is no manual launch API.
```

> **Auto-open:** After `configure()`, the SDK presents the experience automatically once per calendar day (and re-checks when the tab regains focus). It can be disabled remotely via the dashboard's `experience.autoOpenEnabled` kill switch; unregistered users see at most 3 auto-opens until they submit an email.

### Script Tag (UMD)

```html
<script src="/vendor/winr/winr-sdk.umd.js"></script>
<script>
  (async function () {
    await WINR.configure({
      apiKey: 'YOUR_API_KEY',
      bundleId: 'com.example.myapp',
      user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' },
    });
  })();
</script>
```

## Installation

The SDK ships as self-hosted ESM and UMD bundles (with TypeScript declarations). Build them from this repo and serve them with your app:

```bash
git clone https://github.com/AVAFLI/winr_web_sdk.git
cd winr_web_sdk
npm install
npm run build
# outputs: dist/winr-sdk.esm.js, dist/winr-sdk.umd.js, dist/winr-sdk.d.ts
```

- **ESM / bundlers:** copy `dist/winr-sdk.esm.js` (and `winr-sdk.d.ts`) into your project, or add the repo as a git dependency (`npm install github:AVAFLI/winr_web_sdk`) and import `winr-web-sdk`.
- **Script tag:** self-host `dist/winr-sdk.umd.js` and load it with a `<script>` tag — it exposes a global `WINR`.

The bundles are fully self-contained (fonts and imagery embedded, zero runtime dependencies).

> **npm:** The package is not yet published to the public npm registry — `npm install winr-web-sdk` will not work until it is.

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

## The Experience Presents Itself

There is no manual launch API — the WINR experience is exclusively SDK-driven. After `WINR.configure()`, the experience opens automatically at most once per calendar day (first visit of the day, re-checked when the tab regains focus; if `configure()` runs before the DOM is ready, the open is deferred until DOMContentLoaded). Auto-open respects the server-side kill switch (`sdkConfig.experience.autoOpenEnabled`), an unregistered-impression cap (default 3 impressions until the user submits an email), and the RTD opt-out — an opted-out user never sees the experience again.

Entries are claimed silently the moment the experience opens. On day 1 the "You're in!" celebration modal is the reveal (its GOT IT closes the experience). On day 2+ there is no modal: the dashboard holds yesterday's streak label and total behind a "CLAIM {n} ENTRIES" button, and the click reveals the celebration in place — today's tile checks off with confetti, the streak label advances, and the total counts up. The button then reads GOT IT and closes the experience.

## Push Notifications

Streak reminder pushes are primarily a mobile-SDK feature. On the web, `WINR.registerForPushNotifications()` requests the browser's notification permission where supported; otherwise the SDK focuses on in-app engagement through the daily auto-open experience itself.

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
- `winr_device_registered` — Device registered with WINR
- `winr_modal_presented` — The WINR experience auto-opened
- `winr_email_captured` — User completed the email/consent capture
- `winr_daily_entry_claimed` — Daily entries awarded (auto-claimed on open)
- `winr_modal_dismissed` — User closed the WINR experience
- `winr_push_notifications_enabled` — Browser notification permission granted
- `winr_user_data_deleted` — User data deletion completed

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
| `WINR.configure(config)` | `Promise<void>` | Initialize the SDK with user and settings (the experience then auto-opens once per day) |
| `WINR.dismiss()` | `void` | Programmatically close the auto-opened experience |
| `WINR.isAvailable` | `boolean` | Whether the experience is currently available (eligible to auto-open) |
| `WINR.refreshConfig()` | `Promise<void>` | Re-fetch the giveaway/SDK config from the backend |
| `WINR.registerForPushNotifications()` | `Promise<void>` | Request browser notification permission |
| `WINR.deleteUserData()` | `Promise<void>` | Permanently delete all user data |

For detailed API documentation, see the [WINR Docs](https://avafli-website.web.app/sdk/web).

## Example / Demo

A self-contained demo page (with a mock backend) lives in [`example/index.html`](example/index.html). It exercises the auto-open flow, email capture, the day-1 celebration modal, the day-2+ CLAIM reveal, streak modes, winner banner/dialog, and the responsive drawer/modal split.

```bash
npm install
npm run build
npm run demo        # serves the repo at http://localhost:8787
# open http://localhost:8787/example/
```

Use the on-page controls to replay the auto-open (clears the once-per-day mark and reloads), simulate the next day, switch prize types/streak modes, or reset to a fresh install.

## Links

- **Dashboard:** [https://avafli-website.web.app/sdk/dashboard](https://avafli-website.web.app/sdk/dashboard)
- **Documentation:** [https://avafli-website.web.app/sdk/web](https://avafli-website.web.app/sdk/web)
- **Support:** [info@avafli.com](mailto:info@avafli.com)

---

© 2026 Avafli. All Rights Reserved.

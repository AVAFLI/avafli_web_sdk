# WINR Web SDK
**Drop-in sweepstakes, prizing, and gamification for your web application**

[![npm](https://img.shields.io/npm/v/winr-web-sdk.svg)](https://www.npmjs.com/package/winr-web-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/AVAFLI/winr_web_sdk/blob/main/LICENSE)

---

## Overview

WINR lets you add daily-entry sweepstakes and prize experiences to your app in under 20 lines of code. The entire UI — branding, theming, copy, and prize configuration — is managed server-side from the WINR dashboard. You integrate once; your marketing team controls the rest.

**Key capabilities:**
- **Daily entry sweepstakes** — Users earn entries every day they engage
- **Auto-open experience** — Opens automatically on the first visit of each day; entries climb a +10/day ladder and are granted the moment it opens
- **Celebration on open** — Returning users open straight into the celebration: today's tile checks off with a confetti burst, the total counts up and pops, and a "YOU'RE ON A ROLL!" toast leads the bar — no button to press, no modal. Day 1 keeps the one-time "You're in!" welcome modal
- **Email capture** — The SDK captures an email through its own opt-in screen, with an UNCHECKED-by-default marketing-consent tick and a publisher-configurable age gate
- **Cross-device verified adoption** — When a typed email matches an existing account, the SDK confirms a 6-digit code before merging the streak across devices
- **Soft email verification** — A brand-new typed email shows a persistent, dismissible "Verify your email" chip; it never blocks play, only prize-draw eligibility
- **Winner claim flow** — "WE HAVE A WINNER!" splash and a guided prize-claim flow (name, shipping address incl. DC, optional photo), followed by a post-submit share step (optional story + real share actions) and a claim-number confirmation
- **Responsive V2 design** — Bottom drawer on mobile (<768px), centered modal card on desktop (≥768px, widened with a modest type/spacing scale-up at ≥900px)
- **Publisher branding** — Logo, primary color, and prize image configured from the WINR dashboard
- **GDPR/CCPA compliant** — Built-in consent flows, RTD opt-out via `optOut()`, and an in-app "Privacy choices → delete my data"
- **Analytics forwarding** — Route SDK events to your existing analytics stack
- **Shadow DOM isolation** — Styles never leak into your page; fonts and imagery are bundled (no CDN fetches)

## Quick Start

### ES Modules

```typescript
import { WINR } from 'winr-web-sdk';

// 1. Configure the SDK
await WINR.configure({
  apiKey: 'YOUR_API_KEY', // debug builds: use your winr_test_ sandbox key
  bundleId: 'com.example.myapp',
  user: {
    id: 'user_123',            // only id is required — pass whatever identity you have
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com', // include it when you have it — pre-fills & locks the capture form (consent stays explicit)
  },
  // Nobody signed in? omit `user` entirely — the SDK runs a stable guest session
  debug: false, // true while integrating
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
      apiKey: 'YOUR_API_KEY', // debug builds: use your winr_test_ sandbox key
      bundleId: 'com.example.myapp',
      user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' },
    });
  })();
</script>
```

### Identity — pass what you have, the SDK captures the rest

Only `id` is required on `user`. Build it from whatever identity data you
already hold — even just an id — and the SDK fills in the gaps: it captures the
email through its own screen, and the name at prize-claim time if the user wins.
There are three cases:

**1. Signed-in user without an email (the common case, and WINR's main value).**
Pass the id plus whatever you have and OMIT `email`. The SDK shows its capture
screen and the user types their email — so you capture an address you didn't
have before:

```typescript
user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe' }   // no email
```

Even just `{ id: 'user_123' }` is valid — name is collected later at
prize-claim, only if they win.

**2. Signed-in user with an email.** Pass `email` too and it pre-fills and
**locks** the capture field (consent is still an explicit tick inside the flow).
`email` is a plain `string`:

```typescript
user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }
```

**3. No signed-in user at all.** Simply omit `user`:

```typescript
await WINR.configure({
  apiKey: 'winr_live_…',
  bundleId: 'com.example.myapp',
  // no user — guest session
});
```

The SDK mints a stable per-install guest id (`winr_guest_…`) for attribution —
never fabricate placeholder ids yourself. The experience is fully functional
for guests. When the user signs in, call `configure` again with the real user:
attribution upgrades in place and the streak carries over automatically.


## Installation

### npm

```bash
npm install winr-web-sdk@^2.9.0
```

```typescript
import { WINR } from 'winr-web-sdk';
```

### Self-hosted bundles

The SDK also ships as self-hosted ESM and UMD bundles (with TypeScript declarations). Build them from this repo and serve them with your app:

```bash
git clone https://github.com/AVAFLI/winr_web_sdk.git
cd winr_web_sdk
npm install
npm run build
# outputs: dist/winr-sdk.esm.js, dist/winr-sdk.umd.js, dist/winr-sdk.d.ts
```

- **ESM / bundlers:** copy `dist/winr-sdk.esm.js` (and `winr-sdk.d.ts`) into your project, or add the repo as a git dependency (`npm install github:AVAFLI/winr_web_sdk`).
- **Script tag:** self-host `dist/winr-sdk.umd.js` and load it with a `<script>` tag — it exposes a global `WINR`.

The bundles are fully self-contained (fonts and imagery embedded, zero runtime dependencies).

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
| `user` | `WINRUser?` | — | The signed-in user; omit for a guest session |
| `options` | `WINROptions?` | — | Optional behavior toggles |

### WINRUser

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `id` | `string` | ✅ | Unique, stable user identifier (the only required field) |
| `firstName` | `string?` | — | User's first name; captured at prize-claim if omitted |
| `lastName` | `string?` | — | User's last name; captured at prize-claim if omitted |
| `phone` | `string?` | — | Phone number in E.164 format |
| `email` | `string?` | — | If passed, pre-fills and locks the capture field; if omitted, the SDK captures it |

> **Email:** Omit it and the SDK captures an address through its own opt-in
> screen (the common case). Pass it and that address pre-fills and locks —
> consent is still an explicit tick inside the flow. See the three identity
> cases above.

## Test in Development: Your Sandbox Key

Your publisher dashboard shows two API keys:

| Key | Use it in |
| --- | --------- |
| `winr_live_…` | Release builds — your real giveaway |
| `winr_test_…` | Debug/dev builds and CI — an isolated sandbox |

The sandbox key hits the **same production backend** with identical behavior —
registration, streaks, entries, the full experience — but every user and entry
lands in a separate sandbox tenant with its own always-active test giveaway.
That means:

- Your developers and testers **can never enter (or win) your real giveaway.**
- Sandbox usage **never counts toward your MAU** or your bill.
- Your registered bundle IDs work with both keys automatically.

Swap keys per build configuration and nothing else about your integration
changes.

## The Experience Presents Itself

There is no manual launch API — the WINR experience is exclusively SDK-driven. After `WINR.configure()`, the experience opens automatically at most once per calendar day (first visit of the day, re-checked when the tab regains focus; if `configure()` runs before the DOM is ready, the open is deferred until DOMContentLoaded). Auto-open respects the server-side kill switch (`sdkConfig.experience.autoOpenEnabled`), an unregistered-impression cap (default 3 impressions until the user submits an email), and the RTD opt-out — an opted-out user never sees the experience again.

Entries are claimed silently the moment the experience opens. On day 1 the "You're in!" celebration modal is the reveal (its GOT IT closes the experience). On day 2+ there is no modal and nothing to press: the celebration is the dashboard's first visible frame — today's tile checks off with a confetti burst, the streak label advances, the total counts up and pops, and the bar leads with a "YOU'RE ON A ROLL!" toast before settling into the come-back message. The pill reads GOT IT throughout and closes the experience.

## Email Capture & Verification

Email is captured inside the SDK's own opt-in screen (see the identity section above). The screen shows a publisher-configurable **age gate** — an affirmative tick that gates the CTA — and a **marketing-consent** checkbox that is **unchecked by default** and never gates entry (declining it costs neither the entry nor, if drawn, winner contact).

Two verification paths run from that screen:

- **Cross-device verified adoption.** When the typed email matches an existing WINR account (from another device or install), the SDK asks for a **6-digit code** emailed to that address before the two identities are merged — so a streak follows the person across devices without letting anyone attach to someone else's record.
- **Soft email verification (2.7.0+).** A brand-new, never-before-seen typed email surfaces a persistent, dismissible **"Verify your email"** chip on the dashboard. It **never blocks play** — the user keeps earning entries — it only affects prize-draw eligibility until the address is confirmed.

## Winner Experience

When one of your users is drawn as a giveaway winner, the experience automatically opens on a winner splash instead of the dashboard, then walks them through a 3-step prize-claim form with progress dots (name, shipping address, optional photo) plus a review screen, ending in a confirmation with their claim number on a keepsake OFFICIAL WINNER card. The review screen carries a single **optional** likeness/promotion checkbox — unchecked by default, it never gates SUBMIT; its state is reported to the backend as an explicit `promoConsentGranted` boolean (the Official Rules and privacy policy remain as plain links).

After the claim is submitted — and never blocking it — a **share step** invites the winner to tell their story and share the news: X opens a prefilled tweet intent, Facebook opens the share dialog, and Instagram/Snapchat/TikTok use the Web Share API where available (falling back to copy-to-clipboard with a "Copied!" toast). The share line includes your publisher `shareUrl` when one is configured in the dashboard. Closing the share step changes nothing about the claim.

This requires no integration work — the flow appears only for the drawn winner and disappears once their claim is submitted. The winning email is never re-entered; a backend-masked address is displayed for recognition and the claim is keyed to the account server-side.

## Push Notifications

Streak reminder pushes are a mobile-SDK feature. On the web, `WINR.registerForPushNotifications()` is a **logged no-op unless web push is configured** — functional web push needs a VAPID application-server key and a service worker, which this build does not ship. It is also gated on `enablePushReminders`. Web engagement runs through the daily auto-open experience itself, not browser notifications.

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
- `winr_user_data_deleted` — User data deletion completed

## GDPR / CCPA

Handle erasure requests with `optOut()`:

```javascript
await WINR.optOut();
```

This is the complete Right-to-be-Forgotten path. It removes the person's personal
information everywhere it is held — including prize-claim records, which carry name,
address and phone — links their devices together so one call covers all of them, and
permanently silences the experience on the device so it survives a reinstall.

De-identified entry records are deliberately retained. They are the evidence that a
drawing was fair and that a prize went to a real eligible person, which a sweepstakes
operator must be able to show; GDPR Art. 17(3) exempts data needed for legal claims.
The person is erased, the proof is kept.

Users can also self-serve without any code from you: the how-it-works ("?")
screen's **Privacy choices** surface (privacy policy link + **delete my data**)
runs the same erasure as `optOut()`, behind a destructive confirmation.

## API Reference

### Core Methods

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `WINR.configure(config)` | `Promise<void>` | Initialize the SDK with user and settings (the experience then auto-opens once per day) |
| `WINR.dismiss()` | `void` | Programmatically close the auto-opened experience |
| `WINR.isAvailable` | `boolean` | Whether the experience is currently available (eligible to auto-open) |
| `WINR.refreshConfig()` | `Promise<void>` | Re-fetch the giveaway/SDK config from the backend |
| `WINR.registerForPushNotifications()` | `Promise<void>` | Logged no-op on web unless web push (VAPID + service worker) is configured; gated on `enablePushReminders` |
| `WINR.optOut()` | `Promise<void>` | Right-to-delete: submits the user's opt-out and suppresses them permanently |

For detailed API documentation, see the [WINR Docs](https://avafli-website.web.app/sdk/web).

## Example / Demo

A self-contained demo page (with a mock backend) lives in [`example/index.html`](example/index.html). It exercises the auto-open flow, email capture, the day-1 celebration modal, the day-2+ celebration-on-open reveal, streak modes, winner banner/dialog, and the responsive drawer/modal split.

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

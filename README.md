# Avafli Web SDK

**Drop-in daily-streak sweepstakes for any website — one script tag or one `import`.**

[![npm](https://img.shields.io/npm/v/avafli-sdk.svg)](https://www.npmjs.com/package/avafli-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/AVAFLI/avafli_web_sdk/blob/main/LICENSE)

Current release: **avafli-sdk 3.3.0** (npm) — the same build is served from the CDN at `https://sdk.avafli.com/avafli-sdk.umd.js`.

The SDK registers the browser with Avafli, captures an email through its own opt-in screen, and opens a self-contained drawer once a day in which the visitor's daily entries are claimed automatically. Branding, copy, prize, streak ladder and behaviour flags all come from your publisher dashboard; the page integrates once.

**Contents**

1. [Requirements](#1-requirements)
2. [Install](#2-install)
3. [Configure](#3-configure)
4. [What the visitor sees](#4-what-the-visitor-sees)
5. [Controlling when the drawer opens](#5-controlling-when-the-drawer-opens)
6. [Account deletion and the 24-hour rejoin](#6-account-deletion-and-the-24-hour-rejoin)
7. [Testing checklist](#7-testing-checklist)
8. [Analytics](#8-analytics)
9. [Content Security Policy](#9-content-security-policy)
10. [Frameworks, SSR and Next.js](#10-frameworks-ssr-and-nextjs)
11. [Self-hosting the bundle and its assets](#11-self-hosting-the-bundle-and-its-assets)
12. [Networking and offline behaviour](#12-networking-and-offline-behaviour)
13. [API reference](#13-api-reference)
14. [Demo page](#14-demo-page)
15. [Links](#15-links)

---

## 1. Requirements

- **An Avafli publisher account.** Your API keys are on the [publisher dashboard](https://sdk.avafli.com/dashboard). No account yet? [Contact Avafli](https://www.avafli.com/contact).
- **Your site's domain registered as a Bundle ID** on the dashboard (for example `yourdomain.com`). On the web `bundleId` is the domain, not a reverse-DNS app id. The backend validates your key against that list and `configure()` rejects until the domain is listed. Your `avafli_test_` sandbox key accepts the same domains.
- **A browser the SDK can run in:** any current Chrome, Edge, Firefox or Safari (desktop or mobile). The bundle is compiled to ES2022 and needs Shadow DOM, `fetch`, `AbortController`, `localStorage`/`sessionStorage` and cookies. Browsers that block site data still work within a page session (an in-memory fallback), but every load is a new visitor there. The hardened paths cover Safari < 15.4 (no `crypto.randomUUID`, no `:has()`) and plain-http pages.
- **No build step is required** for the script tag. For bundlers, Node 16+ is needed to install the package (the SDK itself has zero runtime dependencies).

## 2. Install

### Script tag (Webflow, Squarespace, plain HTML)

```html
<script src="https://sdk.avafli.com/avafli-sdk.umd.js"></script>
```

- Served from Avafli's CDN with `Cache-Control: public, max-age=300` — browsers pick up a new release within five minutes. The URL has no version segment; the file is always the current release (3.3.0 today).
- One file, 221 KB minified (62 KB gzipped). It exposes a global `Avafli`.
- Because the URL always serves the latest release, a Subresource Integrity hash would break on every update — do not add `integrity=` to this tag. To pin a version (and use SRI), self-host the file: see [Self-hosting](#11-self-hosting-the-bundle-and-its-assets).

### npm / yarn / pnpm (Vite, webpack, Next.js, …)

```bash
npm install avafli-sdk@^3.3.0
```

```typescript
import { Avafli } from 'avafli-sdk';
```

The package ships an ESM build (`dist/avafli-sdk.esm.js`, the 51 KB boot chunk, plus `dist/avafli-sdk.ui.esm.js`, the 170 KB drawer chunk loaded on the first open), a UMD build for `require()`, and TypeScript declarations (`dist/avafli-sdk.d.ts`). Bundlers resolve all of that from `package.json`'s `exports`; nothing to configure.

## 3. Configure

One call at page load is the whole integration. Everything below is the same in both install forms — the script tag just uses the global `Avafli` instead of the import.

```typescript
import { Avafli } from 'avafli-sdk';

const isProduction = location.hostname === 'yourdomain.com';

try {
  await Avafli.configure({
    // Keys are on your dashboard. The avafli_test_ key hits the same backend
    // but lands every user and entry in an isolated sandbox tenant.
    apiKey: isProduction ? 'avafli_live_xxxxxxxxxxxxxxxx' : 'avafli_test_xxxxxxxxxxxxxxxx',
    bundleId: 'yourdomain.com',   // your site's domain, as registered on the dashboard

    // When the SDK may open the drawer by itself (default 'always').
    autoOpen: 'always',           // or 'returningUsersOnly' / 'never' — see section 5

    // Your signed-in user. Only `id` is required; omit the whole object for a
    // guest session (the SDK mints a stable guest id and keeps it in storage).
    user: {
      id: 'user_123',
      firstName: 'Jane',          // optional — collected at prize-claim time if missing
      lastName: 'Doe',            // optional
      email: 'jane@example.com',  // optional — pre-fills AND locks the capture field
    },

    options: {
      analyticsAdapter: myAnalytics, // optional — see section 8
    },
  });
} catch (e) {
  // configure() rejects on a backend refusal (unknown bundleId, suspended
  // account, bad key) — never let it break your own startup.
  console.warn('Avafli disabled:', e);
}
// Done. The drawer opens by itself once a day; to open it on demand: await Avafli.present()
```

Script-tag equivalent:

```html
<script src="https://sdk.avafli.com/avafli-sdk.umd.js"></script>
<script>
  Avafli.configure({
    apiKey: 'avafli_test_xxxxxxxxxxxxxxxx', // swap for your avafli_live_ key in production
    bundleId: 'yourdomain.com',
    autoOpen: 'always',
    // Signed-in site? user: { id: 'user_123', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }
    // Nobody signed in? omit `user` — guest session.
  }).catch(function (e) { console.warn('Avafli disabled:', e); });
</script>
```

### `AvafliConfiguration`

| Field | Type | Required | What it does |
| --- | --- | --- | --- |
| `apiKey` | `string` | yes | `avafli_live_…` for your real giveaway, `avafli_test_…` for the sandbox ([below](#sandbox-key-avafli_test_)) |
| `bundleId` | `string` | yes | Your site's domain, registered under Bundle IDs on the dashboard |
| `user` | `AvafliUser` | no | The signed-in visitor. Omit for a guest session |
| `autoOpen` | `'always' \| 'returningUsersOnly' \| 'never'` | no | When the SDK may open the drawer on its own. Default `'always'`. [Section 5](#5-controlling-when-the-drawer-opens) |
| `options` | `AvafliOptions` | no | See the table below |
| `branding` | `AvafliBranding` | no | Client-side fallback for `logoUrl` and `primaryColor` only. The dashboard's branding always wins when set; the other fields on the type are accepted but not used by the current drawer |
| `assetBaseUrl` | `string` | no | Where the drawer's fonts and images are fetched from. Default `https://sdk.avafli.com/sdk-assets/v2`. [Section 11](#11-self-hosting-the-bundle-and-its-assets) |

### `AvafliUser`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Your stable user id. Sent to the backend as the publisher user id for attribution |
| `firstName`, `lastName` | `string` | no | Letters, spaces, hyphens and apostrophes only, max 50 characters; `configure()` rejects otherwise. If omitted, the winner types them on the claim form |
| `phone` | `string` | no | A US 10-digit number (a leading `+1` is accepted); non-digits are stripped. `configure()` rejects anything else |
| `email` | `string` | no | Pre-fills the capture field **and locks it** so the visitor cannot attach themselves to someone else's account. Supplying it records no consent — the visitor still ticks the boxes and submits. A malformed value is ignored and the field stays editable |

Three identity cases:

1. **Signed-in user, no email on file (the common case).** `user: { id: 'user_123' }` — the SDK captures the email on its own screen and you get an address you did not have.
2. **Signed-in user with an email.** Add `email` and the field is pre-filled and read-only.
3. **Nobody signed in.** Omit `user`. The SDK mints a stable guest id (`avafli_guest_…`, kept in localStorage under your `bundleId`) and the experience is fully functional. When the visitor later signs in, call `configure()` again with the real `user` — a second call with a different `user.id` re-runs registration so the browser attaches to that account; a second call with the same id (or no user) is a no-op.

### `AvafliOptions`

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `analyticsAdapter` | `{ track, identify }` | — | Receives every SDK event. [Section 8](#8-analytics) |
| `enableAgeGate` | `boolean` | `true` | Fallback only — the dashboard's `ageGateEnabled` wins when set |
| `ageGateMinAge` | `number` | `18` | Fallback only — the dashboard's `ageGateMinAge` wins when set |
| `deviceFingerprintProvider` | `() => Promise<string>` | — | Supply your own stable browser id instead of the SDK's random one. Called once per browser; the result is stored and reused |
| `environment` | `'production'` | `'production'` | The only value. There is no separate staging endpoint — the sandbox key is how you test |
| `enablePushReminders` | `boolean` | `false` | Gate for `Avafli.registerForPushNotifications()`, which is a logged no-op on the web in 3.3.0 (no VAPID key / service worker ships with the SDK) |
| `debug` | `boolean` | `false` | **Not read by 3.3.0.** The shipped bundles log at `warn` level and above regardless; verbose logging is only available in a development build of the SDK itself. Setting it is harmless |

### Sandbox key (`avafli_test_`)

Your dashboard shows two keys. Both hit the **same production backend** with identical behaviour — registration, email capture, streaks, entries, the drawer:

| Key | Use it in | Where the data lands |
| --- | --- | --- |
| `avafli_live_…` | Your production site | Your real publisher tenant and your real giveaway |
| `avafli_test_…` | Local dev, staging, CI, QA | A companion **sandbox tenant** with its own evergreen test giveaway |

Sandbox users can never enter or win your real giveaway, sandbox traffic never counts toward your MAU or your bill, and the sandbox accepts the same Bundle IDs you registered for the live key. Draws against the sandbox giveaway are allowed (the winner is flagged as sandbox), so the winner flow can be exercised end to end — ask support to run one. Keys minted before the Avafli rename (`winr_test_…` / `winr_live_…`) remain valid.

### What `configure()` does

1. Validates the config, mints a guest id if there is no `user`.
2. Resolves the browser's device id: `web_` + 24 hex characters, generated once from the CSPRNG and kept in localStorage (`winr_device_fingerprint`) **and** mirrored in a first-party cookie `avafli_did` (400 days, `SameSite=Lax`, `Secure` on https). If localStorage comes back empty but the cookie survived, the id — and the account — is restored instead of a new visitor being minted. Browsers with site data blocked get a deterministic hash of browser signals so a page session is at least internally consistent.
3. Mints an invisible reCAPTCHA Enterprise token (best effort, 4 s cap, never blocking — see [section 4](#4-what-the-visitor-sees)), then calls `registerDevice` (unauthenticated) and stores the session: ID token, refresh token and user id in **sessionStorage** (`winr_token`, `winr_refresh_token`, `winr_uuid`); the giveaway, streak state, consent flag and auto-open marks in localStorage (all `winr_`-prefixed; per-bundle keys end in `_<bundleId>`). Tokens are refreshed proactively before expiry and once more on a 401.
4. Fires `avafli_device_registered`, submits `firstName`/`lastName`/`phone` if any were given (fire-and-forget), calls `identify` on your analytics adapter.
5. Runs the auto-open check ([section 5](#5-controlling-when-the-drawer-opens)). The drawer's code and assets are only fetched when it actually opens.

`configure()` resolves once registration has succeeded. It rejects with an `AvafliError`:

| `error.code` | When |
| --- | --- |
| `invalid_configuration` | Missing `apiKey`/`bundleId`, bad name or phone format, or any non-network failure during setup |
| `service_unavailable` | Your account or key is suspended/revoked. `Avafli.isAvailable` is `false` and `Avafli.unavailableReason` holds this error afterwards |
| `network_error` | The request never completed, or the platform answered 429/5xx through every retry. A transport failure (offline, DNS, timeout) also queues a same-day automatic retry that re-runs `configure()` when the tab comes back online or to the foreground |

## 4. What the visitor sees

Everything in this section is SDK-driven. Nothing here needs host-page code.

**The drawer.** A bottom sheet on viewports narrower than 768 px, a centred modal card from 768 px up (slightly larger type and spacing from 900 px). It is rendered inside a Shadow DOM host (`<div data-winr="v2">` appended to `<body>`), so your CSS and the drawer's never touch. Page scroll is locked while it is open. Fonts (Inter/Oswald) and imagery are fetched from the asset host on first open.

**First visit — email capture.** The capture strip shows the prize, the entries for today, and a form: email (pre-filled and locked when you passed `user.email`), an **age-gate checkbox** (minimum age from your dashboard, default 18) that must be ticked before the CTA enables, and a **marketing-consent checkbox that is unchecked by default** and never gates entry — declining it costs neither the entry nor, if drawn, winner contact. Official Rules and the Privacy Policy open inside the drawer, and a "Protected by reCAPTCHA" attribution line sits under them (see the next paragraph). Submitting claims day 1 and lands on the streak dashboard with a "YOU'RE IN!" greeting and day 1 checked off; GOT IT closes the drawer.

**Bot perimeter.** Registration carries an invisible, score-based **reCAPTCHA Enterprise** token: the first `registerDevice` of a page load lazily adds `https://www.google.com/recaptcha/enterprise.js` to `<head>` (4 s load/execute timeouts) and hides Google's floating badge, which is why the attribution line appears on the capture screen instead. There is never a challenge, and it never blocks anything — if your CSP forbids the script, registration proceeds without a token and the backend decides what to do with that.

**Cross-device adoption.** If the typed email already belongs to an Avafli account under your publisher (another browser or your mobile app), the SDK asks for a **6-digit code** sent to that inbox before the two identities are merged, so a streak follows the person across devices without letting anyone attach to someone else's record. An adoption started but not finished resumes on the code screen next time (a fresh code is sent at most once every 10 minutes; "Send a new code" always sends).

**Soft email verification.** A brand-new typed address shows a dismissible "Verify your email" chip on the dashboard. It never blocks play or the prize draw; confirming early only means the winner skips the claim-time code step.

**Day 2 and on — the streak dashboard.** The daily entries are claimed the moment the drawer opens; there is no button to press. The dashboard's first frame is the celebration: today's tile checks off with a confetti burst, the total counts up, and a "YOU'RE ON A ROLL!" toast settles into the come-back message. Entries per day follow the giveaway's **streak ladder** from your dashboard (the SDK's fallback is `[10, 30, 60, 130, 240, 300]`; after the ladder ends each day adds the latest passed milestone's bonus). A missed day resets a `daily` streak; a giveaway in `visit` mode counts visits and never resets. Reopening the same day shows the dashboard without re-claiming.

**Unregistered-visitor cap.** A visitor who has not submitted an email sees the auto-open at most 3 times (dashboard `experience.unregisteredImpressionCap`), after which the SDK stays quiet until `Avafli.present()` or an email is captured.

**Winner.** When one of your users is drawn, the drawer opens on a winner splash instead of the dashboard — also when the giveaway has already ended and no new one is running. CONTINUE first asks for a **6-digit code** sent to the winning address (skipped for people who already proved the inbox), then a 3-step claim form (name, US shipping address incl. DC with Google Places suggestions when a key is configured on your dashboard, optional photo), a review screen with one optional likeness/promotion checkbox, and a confirmation with the claim number. A post-submit share step (optional story, X/Facebook intents, Web Share API elsewhere, your dashboard `shareUrl` tagged `utm_medium=avafli_share`) never blocks the claim. The winner's email is never re-typed — a backend-masked address is shown for recognition. The claim window is set per giveaway on your dashboard (**default 3 days / 72 hours**, 1–60); an expired claim simply no longer opens. While a claim is pending, the drawer reopens on every page load and, on tab focus, at most every 30 minutes — see [section 5](#5-controlling-when-the-drawer-opens).

**Shared giveaway.** If you opt your publisher into the shared giveaway (one prize pool across many Avafli apps, Avafli LLC as Sponsor of Record), the `Giveaway` carries `scope: "network"` and a `sponsorDisclosure` line (for example "Sponsored by Avafli LLC") which the SDK renders, small and muted, under the prize headline on the capture strip, the prize card and the winner splash. It is legally required and cannot be turned off. Exclusive giveaways carry neither field and look exactly as before.

**No active giveaway.** The drawer does not open; `Avafli.present()` resolves `false`.

**Privacy.** Both legal links open an in-drawer overlay (an `<iframe>` of your rules URL or `https://sdk.avafli.com/sdk/privacy`). The privacy page contains "Delete my data & stop participating" — the in-experience right-to-delete, see [section 6](#6-account-deletion-and-the-24-hour-rejoin).

## 5. Controlling when the drawer opens

**Default:** after `configure()` the drawer opens by itself at most **once per calendar day** (local time) — on the first eligible page load of the day, re-checked when the tab regains focus or visibility (the overnight-tab case). If `configure()` runs before `<body>` exists (a `<head>` script) the check waits for `DOMContentLoaded`. The once-per-day mark is written when the visitor **closes** the drawer, not when it starts loading, so navigating away mid-load does not burn the day.

The check is silent when: the dashboard kill switch `experience.autoOpenEnabled` is `false`; the visitor opted out; your account is suspended; there is no active giveaway (and no pending prize claim); the drawer is already on screen; the unregistered cap is reached; or a hold is in effect.

**Registration and analytics run on `configure()` in every mode.** The mode only decides who opens the drawer.

### `autoOpen` on `configure()`

| Value | Behaviour |
| --- | --- |
| `'always'` (default) | Auto-open once per day when eligible |
| `'returningUsersOnly'` | No auto-open on the page load in which registration created a brand-new user for this browser (the very first visit). Every later load auto-opens as normal |
| `'never'` | The SDK never auto-opens; you call `Avafli.present()` |

The dashboard can narrow this remotely (`experience.autoOpenMode`); the **most restrictive** of the two wins (`never` > `returningUsersOnly` > `always`).

### `Avafli.present(): Promise<boolean>`

Opens the drawer now — from a button, a route, the end of your onboarding. Same guards as the auto-open (configured, not opted out, not suspended, a giveaway or pending claim exists, not already on screen) but it **bypasses the once-per-day mark and the unregistered cap** and counts no impression. On close it writes the day mark so the auto-open does not pop a second time that day. If `configure()` is still registering, `present()` waits for it. It never throws over eligibility: resolves `true` after the visitor closes the drawer (or if it was already open), `false` when there was nothing to show.

### `Avafli.holdAutoOpen()` / `Avafli.releaseAutoOpen()`

`holdAutoOpen()` may be called before `configure()`. While held, the auto-open check backs out before writing anything (no day mark, no impression); `present()` still works. `releaseAutoOpen()` clears the hold and re-runs the check immediately. Both are idempotent.

```typescript
// First-time visitors get your onboarding first; returning visitors get the
// normal once-a-day auto-open.
await Avafli.configure({
  apiKey: 'avafli_live_xxxxxxxxxxxxxxxx',
  bundleId: 'yourdomain.com',
  user: { id: 'user_123' },
  autoOpen: 'returningUsersOnly', // or 'never' to always open it yourself
});

async function onOnboardingFinished() {
  const shown = await Avafli.present(); // false if there is nothing to show
  if (!shown) goHome();
}
```

Prefer to keep the auto-open but pause it while something else is on screen? `Avafli.holdAutoOpen()` before `configure()`, `Avafli.releaseAutoOpen()` when your flow ends.

### Pending prize claim

A winner who closed the drawer must be able to get back to the claim without waiting for tomorrow. While the latest server response reports a pending claim, the auto-open ignores the once-per-day mark, the unregistered cap and `returningUsersOnly`: it opens on every page load, and on tab focus only when 30 minutes have passed since it was last shown. It still respects a hold, the opt-out, suspension, the kill switch and `autoOpen: 'never'` — in that mode call `Avafli.present()`, which lands on the winner splash.

### `Avafli.dismiss()`

Closes the drawer programmatically (fires `avafli_modal_dismissed`).

## 6. Account deletion and the 24-hour rejoin

Visitors can delete their own data at any time from the Privacy Policy screen inside the drawer — no integration needed. If your site has its own delete-account flow, call `optOut()` from it so the person's Avafli data goes with their account:

```typescript
try {
  await Avafli.optOut();
} catch (e) {
  // The request did not reach the backend — nothing was changed locally.
  // Show an error and let the user retry.
}
```

What it does, in order:

1. POSTs the authenticated `/optOut` request. The erasure is **identity-wide** (every device of that person), PII is anonymised everywhere including prize-claim records, and the account is tombstoned so a reinstall or storage wipe cannot resurrect it. De-identified entry records are retained as the legally required evidence that drawings were fair (GDPR Art. 17(3)).
2. Only after the backend confirms: marks the browser opted out (`winr_opted_out_<bundleId>` plus the lift time `winr_opted_out_until_<bundleId>`, from the server's `optedOutUntil` or the call's moment + 24 hours) and fires `avafli_opted_out`. A failed request **throws and marks nothing**, so a deletion can never be silently lost.
3. Until the block lifts nothing is presented and `Avafli.present()` resolves `false`.
4. After 24 hours the person may join again as a brand-new participant with no connection to the old profile: on the next `configure()`, or when the tab returns to the foreground, the SDK drops the old session (tokens, user id, email flag, cached giveaway/streak/claim state, day mark, impression counter) — the device id is kept — registers again, and shows the normal email-capture flow. If the server still reports the block, its time is adopted and the SDK checks again after it.

Entries and streaks are forfeited and cannot be restored; the in-drawer confirmation says so. There is no separate "delete user data" call — `optOut()` is the erasure.

## 7. Testing checklist

1. **Use the `avafli_test_` key** on every non-production host. The backend validates the `bundleId` value you pass, not the page's origin, so a page on `localhost` or `staging.yourdomain.com` can pass `bundleId: 'yourdomain.com'` as long as that domain is registered — the sandbox accepts the live key's list.
2. **Watch the network panel.** A working load shows `POST …cloudfunctions.net/registerDevice` → 200. The drawer's own `getActiveGiveaway` and `claimDailyEntries` follow when it opens. A 4xx with a JSON `error` body is a backend refusal (unknown bundleId, suspended key) and is surfaced by `configure()` immediately.
3. **First visit:** the capture screen appears (auto-open) or `await Avafli.present()` resolves `true` after you close it. Submit an email; the dashboard greets with "YOU'RE IN!" and day 1 checked; `avafli_email_captured` then `avafli_daily_entry_claimed` reach your adapter.
4. **Return visit (same day):** reload — no auto-open (day mark set); `Avafli.present()` shows the dashboard with today claimed.
5. **Next day:** reload after local midnight — the drawer auto-opens and claims day 2 with the celebration. To simulate without waiting, clear `localStorage['winr_last_auto_present_<bundleId>']` and reload (the sandbox backend still enforces one claim per local day).
6. **Reset to a fresh visitor:** remove every `localStorage` key starting with `winr_` or `avafli_`, clear `sessionStorage`, and delete the `avafli_did` cookie — the cookie mirror restores the account otherwise. The [demo page](#14-demo-page) has a one-click reset.
7. **Cross-device adoption:** register in a second browser (or private window after a reset) with the same email — the 6-digit code screen must appear before the streak carries over.
8. **Guest → signed-in:** `configure()` without `user`, then again with `user: { id }` — the second call re-registers (watch for a second `registerDevice`).
9. **Presentation:** try `autoOpen: 'never'` with a button calling `Avafli.present()`, and `holdAutoOpen()` before `configure()` / `releaseAutoOpen()` later.
10. **Deletion:** Privacy Policy → "Delete my data" (or `Avafli.optOut()`), confirm; `present()` must resolve `false`, and 24 hours later (or after clearing the two `winr_opted_out*` keys) the capture flow returns.
11. **Safari specifically** (iPhone and Mac): confirm the account survives closing and reopening the browser (device-id cookie), that Private Browsing behaves as a new visitor per tab (expected — site data is blocked), that the legal overlay loads (it is blocked only if *your* CSP's `frame-src` excludes `sdk.avafli.com`), and that the software keyboard never hides VERIFY / submit buttons on the code and claim screens.
13. **Winner flow:** once a draw has been run against your sandbox giveaway, reload the winner's browser: splash → code → form → confirmation. Close the drawer and reload — it must reopen on the splash.
12. **CSP:** with your production policy applied, open the drawer and the Privacy Policy and check the console for blocked fonts, images, frames or `connect-src` — [section 9](#9-content-security-policy).

## 8. Analytics

Pass a plain object with `track` and `identify` in `options.analyticsAdapter`. The TypeScript interface is `AnalyticsAdapter`.

```typescript
import { Avafli, type AnalyticsAdapter } from 'avafli-sdk';

const analytics: AnalyticsAdapter = {
  track(event, properties) { segment.track(event, properties); },
  identify(userId, traits) { segment.identify(userId, traits); },
};

await Avafli.configure({ apiKey, bundleId, user, options: { analyticsAdapter: analytics } });
```

Events (all strings; `properties` is a plain object or `undefined`):

| Event | When | Notable properties |
| --- | --- | --- |
| `avafli_device_registered` | `configure()` registered the browser. **Not delivered on the `configure()` call that installs your adapter** — it fires before the adapter is attached, so you only see it on a later re-configure (guest → user) or an offline registration retry | `isReturningUser` (known under another publisher), `giveawayId` |
| `avafli_modal_presented` | The drawer opened (auto-open or `present()`) | `giveawayId` |
| `avafli_email_captured` | The capture form was submitted | — |
| `avafli_adoption_verified` | The cross-device 6-digit code was accepted | — |
| `avafli_email_verified` | The soft-verification chip's code was accepted | — |
| `avafli_daily_entry_claimed` | Today's entries were granted | `day`, `entries`; `recovered_offline: true` when a queued retry landed it |
| `avafli_modal_dismissed` | Your code called `Avafli.dismiss()`. Not emitted when the visitor closes the drawer (GOT IT, the X, the backdrop) | — |
| `avafli_winner_claim_shown` | The winner splash was shown | — |
| `avafli_claim_email_verified` | The winner's claim-time code was accepted | — |
| `avafli_prize_claim_submitted` | The claim form was submitted | — |
| `avafli_opted_out` | A deletion was confirmed by the backend | — |

`identify(user.id, { firstName, lastName })` is called once per `configure()`. Events emitted while offline are buffered (last 100, persisted) and flushed with `original_timestamp` / `original_timestamp_ms` when the browser is back online.

## 9. Content Security Policy

If your site sends a CSP, allow these — otherwise the SDK fails silently at the blocked step:

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `https://sdk.avafli.com` | The CDN script tag (not needed when bundling or self-hosting) |
| `script-src`, `frame-src` | `https://www.google.com` `https://www.gstatic.com` | The invisible reCAPTCHA Enterprise perimeter on registration. Optional: when blocked, registration simply proceeds without a token |
| `connect-src` | `https://us-central1-winr-9c11f.cloudfunctions.net` | Every SDK API call |
| `connect-src` | `https://places.googleapis.com` | Only if you configured a Places key on the dashboard (address suggestions on the claim form) |
| `font-src`, `img-src` | `https://sdk.avafli.com` (or your `assetBaseUrl` host) | Drawer fonts and imagery |
| `img-src` | `data:` plus the hosts of your dashboard `logoUrl` and `prizeImageUrl` | Placeholder SVGs while images load and the winner's own claim-photo preview are `data:` URIs; your logo and prize art load from wherever you host them |
| `frame-src` | `https://sdk.avafli.com` plus the host of your Official Rules URL | The in-drawer legal overlay. If framing is blocked the overlay offers "Open in new tab" after 8 s |
| `style-src` | `'unsafe-inline'` | The drawer injects its stylesheet as a `<style>` element inside its shadow root, plus an `@font-face` block and the reCAPTCHA badge-hiding rule into `<head>`; none of them can carry your nonce |

The delete bridge inside the privacy page only accepts `postMessage` events whose origin is exactly `https://sdk.avafli.com` and whose data is `{ type: 'avafli-delete' }` (or the legacy `winr-delete`), and only while the overlay is open.

## 10. Frameworks, SSR and Next.js

- **Importing is side-effect free** on the server: the module touches `window`/`document` only inside guarded code. **Calling `configure()` is not** — it would register from Node (`fetch` exists there). Call it from browser-only code: a `useEffect`, a `'use client'` component, `onMounted`, or a script tag.
- Call `configure()` **once per page load**, not per route change. In a SPA it stays configured across client-side navigation; the auto-open re-checks on tab focus, not on route change.
- Guest → signed-in: call `configure()` again when your auth state resolves with a real `user.id` (see [section 3](#3-configure)).

```tsx
'use client';
import { useEffect } from 'react';
import { Avafli } from 'avafli-sdk';

export function AvafliLoader({ user }: { user?: { id: string; email?: string } }) {
  useEffect(() => {
    Avafli.configure({
      apiKey: process.env.NEXT_PUBLIC_AVAFLI_KEY!,   // avafli_test_ in preview deploys
      bundleId: 'yourdomain.com',
      user,                                         // undefined → guest session
    }).catch((e) => console.warn('Avafli disabled:', e));
  }, [user?.id]);
  return null;
}
```

## 11. Self-hosting the bundle and its assets

**The bundle.** Build from this repo and serve the output yourself (pins a version, keeps third-party script off your page):

```bash
git clone https://github.com/AVAFLI/avafli_web_sdk.git && cd avafli_web_sdk
npm install
npm run build:prod   # minified: dist/avafli-sdk.umd.js (221 KB), dist/avafli-sdk.esm.js (51 KB) + dist/avafli-sdk.ui.esm.js (170 KB), dist/avafli-sdk.d.ts
```

`npm run build` produces the same files **unminified** (about 2.5× larger) — use `build:prod` for anything you ship. For the ESM pair keep both files side by side: the boot file loads the UI chunk with a relative `import()` on the first open. The UMD file is self-contained. Or add the repo as a git dependency: `npm install github:AVAFLI/avafli_web_sdk` (its `prepare` script runs the production build).

**The assets.** Since 3.2.1 the drawer's eight Inter/Oswald `woff2` faces and five images are **not** embedded. They are 13 content-hashed files (`<name>.<8-hex>.<ext>`, about 540 KB in total) served from `https://sdk.avafli.com/sdk-assets/v2/` with `Cache-Control: public, max-age=31536000, immutable` and `Access-Control-Allow-Origin: *`. Nothing is fetched until the drawer opens; images paint a solid placeholder of their final size until the bytes land (no layout shift) and text uses `font-display: swap`.

To serve them yourself (strict CSP, intranet, your own CDN): copy the files from the `avafli-website` repo (`public/sdk-assets/v2/`, hashed names included), serve them with the same two headers, and pass the directory:

```typescript
await Avafli.configure({
  apiKey, bundleId,
  assetBaseUrl: 'https://cdn.example.com/avafli', // or a same-origin path such as '/vendor/avafli'
});
```

A trailing slash is ignored; blank falls back to the Avafli host. The file list for the version you run is `src/ui/v2/assets.generated.ts`.

## 12. Networking and offline behaviour

Every call is a Firebase callable function on `https://us-central1-winr-9c11f.cloudfunctions.net` with a 10 s timeout. Nothing to configure:

- **Transport failures** (no response at all — offline, DNS, timeout): three attempts with jittered backoff. A failed registration or daily claim is additionally queued (`winr_offline_pending_intents_<bundleId>`) and retried the same local day when the `online` event fires or the tab comes to the foreground (hard cap of 5 attempts per page session). Duplicate retries are safe: the backend dedups daily claims and "already claimed" counts as success.
- **Infrastructure refusals** (429/500/502/503/504 with a non-JSON body, e.g. no warm instance yet): up to four retries on 1 s, 2 s, 4 s, 8 s base delays with full jitter (about 15 s worst case); a `Retry-After` header is honoured up to 10 s. Only after that does the host see a `network_error` with `httpStatus` set — and it is **not** queued, because the server answered.
- **Backend rejections** (a callable error body: already entered today, consent required, geo-blocked, rate limit, code cooldown): surfaced at once, never retried. The error's `details` (`reason`, `retryAfterSeconds`, `attemptsRemaining`, …) is on `AvafliError.details`.
- **401:** one token refresh, then one retry. Concurrent callers share a single refresh.

## 13. API reference

All methods are `static` on the `Avafli` class. In the script-tag build the global `Avafli` *is* this class.

| Member | Signature | Notes |
| --- | --- | --- |
| `configure` | `(config: AvafliConfiguration) => Promise<void>` | [Section 3](#3-configure). Rejects with `AvafliError` |
| `present` | `() => Promise<boolean>` | Open now. `false` when there is nothing to show |
| `holdAutoOpen` / `releaseAutoOpen` | `() => void` | Defer / resume the once-a-day auto-open. Safe before `configure()` |
| `dismiss` | `() => void` | Close the drawer |
| `optOut` | `() => Promise<void>` | Right-to-delete; throws if the backend did not confirm. [Section 6](#6-account-deletion-and-the-24-hour-rejoin) |
| `isAvailable` | `boolean` (getter) | `false` until configured, and whenever the account/key is suspended or revoked |
| `unavailableReason` | `AvafliError \| null` (getter) | The `service_unavailable` error when suspended, else `null` |
| `refreshConfig` | `() => Promise<void>` | Re-fetch the dashboard config (branding, flags) without reopening. Rejects with `network_error` on failure |
| `registerForPushNotifications` | `() => Promise<void>` | Logged no-op on the web in 3.3.0 (needs `enablePushReminders` and, in a future build, VAPID + a service worker) |

`Avafli.getAPI()`, `Avafli.submitEmailAndAdopt()` and `Avafli.getResolvedSDKConfig()` are also public on the class; they exist for the drawer's own code and are not a stable host-page API.

### Other exports

| Export | Kind | Use |
| --- | --- | --- |
| `AvafliError` | class | `code: AvafliErrorCode`, `message`, `originalError?`, `httpStatus?`, `details?`; `error.name === 'AvafliError'` |
| `AvafliErrorCode` | enum | `not_configured`, `invalid_state`, `authentication_required`, `network_error`, `ineligible_today`, `giveaway_not_active`, `invalid_email`, `age_verification_required`, `rewarded_video_unavailable`, `invalid_configuration`, `service_unavailable` |
| `AVAFLI_CONSTANTS` | object | `SDK_VERSION` (`'3.3.0'`, always equal to the package version), `PLATFORM_OS`, `PRIVACY_URL`, `DEFAULT_STREAK_LADDER`, `STORAGE_KEYS` |
| `AvafliConfiguration`, `AvafliOptions`, `AvafliUser`, `AvafliBranding`, `AvafliAutoOpen` | types | The `configure()` input |
| `AnalyticsAdapter` (alias `AnalyticsAdapterInterface`) | type | Your adapter |
| `Giveaway`, `GiveawayWinner`, `StreakState`, `MilestoneConfig`, `MilestoneAward`, `DailyEntryGrant`, `AdConfig`, `SDKConfig`, `ExperienceConfig`, `Theme`, `StorageProvider`, `Logger` | types | Payload shapes, for publishers reading `getAPI()` responses |
| `StreakEngine`, `NetworkClient`, `LocalStorageProvider`, `SessionStorageProvider`, `createTheme` | classes / function | Internals exported for advanced use; the drawer does not depend on you using them |

In the UMD build these are attached to the global: `Avafli.AvafliError`, `Avafli.AvafliErrorCode`, `Avafli.AVAFLI_CONSTANTS`, `Avafli.StreakEngine`, `Avafli.LocalStorageProvider`, `Avafli.SessionStorageProvider`, `Avafli.NetworkClient`, `Avafli.createTheme` (and `Avafli.Avafli` / `Avafli.default` for compatibility).

## 14. Demo page

[`example/index.html`](example/index.html) is a self-contained page with a mock backend (it intercepts the SDK's `fetch` calls, so no key is needed). It exercises the auto-open, email capture, the day-1 "YOU'RE IN!" dashboard, the day-2+ celebration, `autoOpen` modes with an "Open now" button (`Avafli.present()`), "Delete my data" (`Avafli.optOut()` and the 24-hour block), streak modes, the winner banner and the responsive drawer/modal split, and logs every analytics event.

```bash
npm install
npm run build:prod
npm run demo        # serves the repo at http://localhost:8787
# open http://localhost:8787/example/
```

## 15. Links

- **Publisher dashboard (keys, Bundle IDs, giveaways, branding):** [sdk.avafli.com/dashboard](https://sdk.avafli.com/dashboard)
- **Web integration guide:** [sdk.avafli.com/web](https://sdk.avafli.com/web)
- **Official Rules / Privacy Policy as shown in the drawer:** [sdk.avafli.com/sdk/rules](https://sdk.avafli.com/sdk/rules) · [sdk.avafli.com/sdk/privacy](https://sdk.avafli.com/sdk/privacy)
- **npm:** [npmjs.com/package/avafli-sdk](https://www.npmjs.com/package/avafli-sdk) · **Source:** [github.com/AVAFLI/avafli_web_sdk](https://github.com/AVAFLI/avafli_web_sdk) · **Changelog:** [CHANGELOG.md](CHANGELOG.md)
- **Support:** [info@avafli.com](mailto:info@avafli.com)

---

© 2026 Avafli. All rights reserved.

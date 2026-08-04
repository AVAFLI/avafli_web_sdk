# Changelog

## [2.2.0] - 2026-08-04

- **Day 2+ reveal flow** (parity with iOS `e7fae27`) — the auto-claim still
  fires silently the moment the experience opens, but for returning users
  (streak day 2+) there is no celebration modal anymore. The dashboard opens
  pinned to YESTERDAY's numbers — streak label N-1, pre-claim total, today's
  tile in a new `ready` state (accent glow + white flame, no checkmark, no
  confetti) — behind a "CLAIM {n} ENTRIES" pill. Clicking it is the reveal:
  the tile checks off with confetti, the streak label advances, the total
  counts up to the post-claim value, and the pill becomes "GOT IT" (which
  closes the experience). The come-back bar shows the next day's entries in
  both states.
- **Day 1** keeps the "You're in!" celebration modal as its reveal (email
  capture → claim → modal); its GOT IT now closes the whole experience.
- **Copy** — email-capture CTA renamed "GET MY {n} ENTRIES" →
  "CLAIM MY {n} ENTRIES".
- **Fixed: auto-open never firing when `configure()` runs before the DOM is
  ready** (e.g. the SDK snippet in `<head>`). The shadow-DOM host was appended
  to `document.body` before it existed, the resulting error was swallowed, and
  — because the once-per-day mark and the unregistered-impression count were
  written *before* presentation — every same-day re-check short-circuited and
  the SDK stayed silent (after 3 such days, permanently for unregistered
  users). The auto-open check now defers until DOMContentLoaded when `<body>`
  isn't available yet, rolls the once-per-day mark and impression count back
  if a presentation fails to mount, and releases the internal
  "already on screen" guard on a failed mount.

- **Removed (BREAKING)** — manual `WINR.present()` and `WINR.presentInline()`
  (and the `PresentationOptions` export): the experience is exclusively
  auto-opened by the SDK, at most once per calendar day (server kill switch,
  unregistered impression cap, and RTD opt-out respected). Integration is
  `WINR.configure()` only.
- README corrections (auto-open-only integration; demo replay reworked to
  clear the once-per-day mark and re-run the auto-open engine)

## 2.0.0 (2026-08-03)

- **V2 experience** — full port of the iOS V2 design (Joe's Figma): gunmetal drawer,
  bundled Inter/Oswald fonts, prize card with default cash hero, horizontally
  scrolling streak rail with accelerator milestone tiles, come-back bar,
  celebration modal with animated checkmark + looping confetti, how-it-works,
  and the "WE HAVE A WINNER!" banner + gold winner dialog
- **Responsive presentation** — bottom drawer (iOS-style, 90% height, 30px top
  radius) below 768px; the same content as a centered modal card (~440px,
  24px radius, scale/fade) at 768px and up
- **Auto-open engine** — the experience opens automatically on the first visit
  of each calendar day (server kill switch `sdkConfig.experience.autoOpenEnabled`;
  unregistered users capped at `experience.unregisteredImpressionCap` auto-opens,
  default 3; RTD opted-out users never see it)
- **Auto-claim** — entries are granted automatically when the experience opens;
  celebration on success, silent claimed-state + one-shot re-sync on
  "Already claimed" (another device claimed first)
- **API models** — `Giveaway.prizeImageUrl`, `Giveaway.streakMode`
  ("daily" | "visit"), `Giveaway.latestWinner`, `SDKConfig.experience`
- **Shadow DOM everywhere** — the whole experience renders inside a shadow root;
  fonts/imagery ship embedded in the bundle (no CDN fetches)
- **Removed** — rewarded-video/bonus flow and the `rewardedVideoProvider`
  option; Lottie/server-media rendering (V2 hardcodes the design; branding is
  logo + primaryColor + prizeImageUrl only)

## 1.0.0

- Initial release
- Daily streak engagement system (3-tier: base, weekly bonus, monthly bonus)
- Email capture with age gate (18+)
- Rewarded video provider interface
- Server-driven SDK config
- GDPR compliance (deleteUserData)
- Shadow DOM UI isolation
- ESM + UMD bundle formats
- TypeScript declarations included
- Zero runtime dependencies

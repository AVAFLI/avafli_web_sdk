# Changelog

## 2.0.0 (unreleased)

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

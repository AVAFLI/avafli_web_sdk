# Changelog

## [2.3.3] - 2026-08-05

Load-experience defects found testing the SDK inside a real publisher app
(ported from the Flutter SDK's 2.3.3).

### Fixed
- **The drawer no longer sits on a loading state for seconds.** It auto-opens
  ahead of its sequential network calls (registerDevice → getActiveGiveaway →
  claim). When the browser already has a cached giveaway AND a persisted
  streak, the real dashboard now paints IMMEDIATELY from that cache and the
  fresh response reconciles in place — reusing the same no-replay guards the
  celebration staging already used, so the celebration still fires exactly
  once (the come-back bar now accepts a late-arriving toast rather than
  missing it, and a one-shot marker keeps it from playing twice). The
  email-capture gate is unchanged: an unconsented user NEVER sees a cached
  dashboard. A cache-rendered dashboard also survives a subsequent network
  failure instead of collapsing to the empty state.
- **Cold start shows a skeleton, not a spinner.** With nothing cached to paint,
  the loading view is now a pulsing block-out of the real layout (grab handle,
  header, prize card, three streak tiles, come-back bar, CTA pill) in the
  drawer's own gunmetal instead of a centered spinner and "Loading…". One
  shared pulse keeps every block in phase, and `prefers-reduced-motion` stills
  it.
- **The prize image arrives with the card instead of popping in after it.**
  The publisher's `prizeImageUrl` (and `branding.logoUrl`) are now pulled into
  the browser's image cache as soon as the SDK learns the giveaway config — at
  registration, on every giveaway refresh, and once more when the experience
  mounts — so the card normally paints its art on its first frame. Already
  warmed URLs are no-ops; a failed one is dropped so the next refresh retries;
  non-DOM/SSR hosts are a safe no-op. A cold URL fades in over ~200ms against
  the card's deep charcoal rather than flashing, and a broken one falls back
  to the bundled cash hero.
- **Email consent is cached on submit.** A successful email submit now sets the
  SDK's cached `emailConsentStatus` immediately instead of waiting for the next
  `getActiveGiveaway`, so the auto-open engine's unregistered-impression cap
  can't read stale consent regardless of check ordering.

### Tests
- 22 new: cache-first render (painted without waiting on the network, calm
  frame with no celebration artifacts, cold cache → skeleton, unconsented user
  → email capture, no stomping of fresher truth, offline survival), the
  late-arriving come-back toast firing exactly once, and image prewarming
  (warm once, no-op on repeat, retry after failure, `decode()`-less fallback,
  safe when `Image` is undefined) plus the hero's fade/warm/fallback paths.

## [2.3.0] - 2026-08-04

- **Winner prize-claim flow (Joe's stepped design)** — when the backend marks
  the user as the drawn winner (`prizeClaim.status == "pending"` on
  `getActiveGiveaway`), the experience opens on the winner splash instead of
  the dashboard: CONGRATULATIONS! + prize strip → a 4-step form with a
  persistent header, "STEP N OF 4" label, and four connected accent progress
  dots (steps slide horizontally; back chevron from step 2 on):
  1. TELL US ABOUT YOURSELF — first/last name, the locked masked winning
     email (`prizeClaim.maskedEmail`, generic copy fallback), optional phone;
  2. WHERE SHOULD WE SEND YOUR PRIZE? — street/apt/city, 50-state + DC
     picker + 5-digit zip, Country locked US;
  3. SHOW OFF YOUR WIN! — optional photo via a circular preview with camera
     badge, UPLOAD PHOTO / TAKE PHOTO (camera capture on devices that have
     one), client-side downscale to ≤1200px JPEG ≤5MB;
  4. PLEASE SHARE A LITTLE — optional story (sent as `story`, trimmed) and a
     Share-on-Social-Media glyph row (native share sheet where available);
  then the ALMOST DONE! review screen — three required consent checkboxes
  (accuracy, likeness release, Official Rules/Privacy Policy), SUBMIT PRIZE
  CLAIM, and the secure-and-encrypted lock note — → `submitPrizeClaim` →
  confirmation with the gold OFFICIAL WINNER card and RETURN TO APP.
  Appears automatically — no integration work — and takes precedence over the
  email gate; a pending claim even outlives its giveaway. The daily
  auto-claim still fires silently while the flow is up. An already-submitted
  claim shows the normal dashboard, and a stale "Not the winner"/"Already
  submitted" rejection falls back to the dashboard silently instead of
  trapping the user in the form.
- **First-frame celebration beat** — on a claim-day open the dashboard mounts
  with a PREDICTED grant already staged from the pre-claim status (ladder math
  mirrors the backend), so the celebration is the first visible frame; the
  real claim runs in the background and reconciles totals/streak silently in
  place (no second celebration; "Already claimed" re-syncs once and other
  failures settle back to server truth quietly). The 2.2.0 "CLAIM {n}
  ENTRIES" click is gone — nothing to press, the pill reads GOT IT
  throughout, and only the Day-1 "You're in!" welcome modal remains.
- **Toast-first come-back bar, new copy** — on celebration opens the bar's
  first visible state is the "YOU'RE ON A ROLL! / Your {N} entries have been
  added automatically." toast; it holds ~2.5s, then slides once to the
  resting come-back pitch. Non-celebration opens rest on the pitch.
- **Reveal-beat tile: confetti-burst explosion + restored check/confetti** —
  the active day tile keeps the drawn draw-on check, falling-confetti field,
  and pulsing glow, now topped by a one-shot confetti-burst GIF explosion
  that overflows the tile (the big-check tile-burst GIF was rejected and
  removed). The burst fires only on the reveal, never on a same-day reopen.
- **Count-up total with burst** — Total Entries counts up (ease-out) and pops
  a confetti burst as it lands.
- **Prize card — the Delta A/B visuals** — dark and full-bleed: the prize
  image fills the whole card, the streak/total-entries stats sit in a solid
  black strip inside the top edge, and the headline overlays the bottom over
  a black→transparent scrim, in two layouts (A: right-aligned "WIN $1,000 /
  CASH PRIZE" for cash; B: centered "Win a {Prize}" + accent value line
  otherwise).

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

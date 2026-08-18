# Changelog


## 2.9.5 — 2026-08-18

- **Legal documents open inside the experience** — Official Rules and the
  Privacy Policy now open in an in-experience overlay (slim header + iframe
  over the drawer/lightbox, works in both the mobile drawer and the desktop
  lightbox) instead of a new browser tab. Every legal entry point routes
  through it: the capture screen's inline disclaimer links, the legal links
  row (dashboard, code screen), and the how-it-works fine print. A loading
  veil covers the frame; if it never loads (some publisher CSPs block
  framing winrmedia.com — detected best-effort via timeout) the veil becomes
  an "Open in new tab" fallback.
- **"Delete my data" moved into the privacy page** — the overlay loads the
  privacy policy with `?app=1` appended (URL-API built, tolerant of existing
  query strings), which makes winrmedia.com/sdk/privacy render its delete
  section; in the framed case the page posts `{ type: "winr-delete" }` to
  the parent. The SDK's bridge accepts that message ONLY from
  `https://winrmedia.com`, only with exactly that shape, and only while the
  overlay is open (the listener detaches on close); a valid message closes
  the overlay and raises the EXISTING destructive confirmation +
  authenticated erasure flow, unchanged. The intermediate "Privacy choices"
  card (2.9) is gone. The delete confirmation now mounts at root level so
  the bridge can raise it over any screen.
- **How-it-works "Privacy choices" fine print removed** — the third privacy
  entry point was redundant once the delete path moved into the privacy
  page: the legal-links row (dashboard, code entry) and the capture screen's
  inline disclaimer links keep it findable. The link, its string, and its
  CSS are deleted.
- **Share-link UTM tagging** — when the publisher's `shareUrl` is included
  in a share action, the SDK appends `utm_source={network}&utm_medium=winr_share`
  ({network} = x | facebook | instagram | snapchat | tiktok, per the tapped
  button; Web Share API / clipboard paths keep their network's value). Built
  with the URL API so URLs with existing query strings extend correctly, and
  a shareUrl that already carries a `utm_source` param is left untouched
  (publisher tagging wins). Share-text URLs only — the Facebook host-page
  fallback (no shareUrl configured) is not tagged; nothing else changes.

## 2.9.4 — 2026-08-17

Winner-flow design round (Ryan's direction, Joe's updated Figma frames).

- **Claim review screen slimmed to its essentials** — the leftover
  "Official Rules • Privacy Policy" links row is removed from the review
  screen (it had survived 2.9.3's capture-screen dedupe). The screen now
  shows only the optional likeness checkbox, SUBMIT, and the
  secure-and-encrypted note; the capture screen's inline disclaimer links
  carry the legal surface.
- **Likeness consent names the actual publisher** — "I authorize {name} and
  its promotional partners…" where {name} is the server-fed
  `sdkConfig.appName` (new optional config field), falling back to the host
  page's `document.title` (the share line's same source), then to the
  previous generic "this app's publisher" wording.
- **Winner splash confetti** — the splash now plays a celebration layer on
  appearance (Joe's frame): the looping multicolor confetti field over the
  screen plus the one-shot Figma confetti-burst GIF over the trophy art.
  Purely decorative and non-blocking (pointer events pass through). Works in
  both the mobile drawer and the desktop lightbox. `createConfetti` now
  respects `prefers-reduced-motion` everywhere it is used: under `reduce`
  the field freezes to a single static frame, and the splash skips the GIF
  burst entirely.
- **Confirmation screen matches Joe's frame (5386:5807)** — the
  "YOUR PRIZE CLAIM HAS BEEN SUBMITTED" screen now celebrates on appearance
  with the same confetti machinery as the splash (looping field + one-shot
  burst centered on the gold keepsake card, reduced-motion aware,
  non-blocking); the "3-5 Business Days" card is a solid dark gunmetal card
  with a subtle border (envelope ring and days line already rode the
  publisher accent); and the keepsake card's OFFICIAL / WINNER labels render
  in the publisher accent instead of fixed gold. No bottom attribution
  strip.
- **"EARN." in the publisher's primary color** — the capture screen's
  VISIT. EARN. WIN. title renders "EARN." in the publisher's brand accent
  (`--wv2-accent`); VISIT. and WIN. stay white.
- **Capture checkboxes tinted with the primary color** — the 18+ and
  marketing-consent boxes: checked is an accent-filled square with a white
  check (matching the review consent box and the CTA pill), unchecked an
  accent-tinted outline.

## 2.9.3 — 2026-08-14

Note: 2.9.2 was never published to npm; 2.9.3 supersedes it.

- **Capture screen legal text deduplicated** — the disclaimer sentence and a
  separate "OFFICIAL RULES • PRIVACY POLICY" links row both appeared on the
  email capture screen. Now ONE instance: "Official Rules" and "Privacy
  Policy" inside the sentence are underlined, tappable links (same targets
  and new-tab behavior as the row), and the separate links row is removed
  from the capture screen only. Other screens that show the links row (claim
  review, how-it-works, code screen) are unchanged, and the capture screen
  keeps the reCAPTCHA attribution notice (required while the badge is
  hidden) and the Powered-by line.
- **Capture legal block bottom-anchored** — the legal block (disclaimer +
  reCAPTCHA notice + Powered-by) now sits at the bottom edge of the drawer
  instead of congested under the CTA; on short viewports (keyboard open) it
  degrades to normal scrollable flow and never overlaps the button. In the
  content-sized desktop lightbox it gets fixed comfortable spacing instead.
- **Privacy Policy links point at the real policy** — every "Privacy Policy"
  link (capture inline, legal-links row, claim review, privacy-choices
  surface) opened `rulesUrl`, a latent bug shared with the native SDKs (no
  privacy URL existed in config). They now open
  `https://winrmedia.com/sdk/privacy` (new `WINR_CONSTANTS.PRIVACY_URL`).
  "Official Rules" keeps `rulesUrl`.

## 2.9.2 — 2026-08-14

- Desktop lightbox matches the final Figma design (colored brand border,
  748px card). ≥900px only: 30px radius, 4px border in the publisher's
  primary color, 0 0 40px shadow, auto content height, and the Figma type
  ramp (49px VISIT. EARN. WIN., 27px prize strip, 35px HOW IT WORKS strip,
  36px/20px items, accent tagline, 360/343px CTA pills). Mobile/tablet
  untouched.

## 2.9.1 — 2026-08-14

- Share screen social icons updated to the official WINR brand set (Figma).

## 2.9.0 — 2026-08-14

Post-submit share step with real share actions, claim review slimmed to one
optional promo-consent checkbox, in-experience privacy-choices surface,
cross-device adoption re-entry, and a conservative desktop layout.

- **Claim review simplified** — the "information is accurate" and "agree to
  Official Rules" checkboxes are gone (rules and privacy policy remain as
  plain links). Only the likeness/promotion checkbox remains: **optional**,
  unchecked by default (affirmative-consent posture, Android parity), and it
  never gates SUBMIT. Its state is always sent as an explicit
  `promoConsentGranted` boolean.
- **Share step moved after submit** — the claim flow is now 3 steps +
  review/submit → share → confirmation. The claim is recorded before the
  share step appears, and closing it changes nothing. The story typed on the
  share step no longer rides `submitPrizeClaim`; it is attached via the new
  authed `attachClaimStory` callable (`{story}` → `{saved}`), flushed on DONE
  and on every dismissal path — fire-and-forget with one retry, at most once.
- **Real share actions** — X opens a tweet intent with a prefilled line;
  Facebook opens the sharer with the URL only (the platform disallows
  prefilled text); Instagram/Snapchat/TikTok use the Web Share API when
  available, else copy-to-clipboard with a "Copied! Paste it in your post"
  toast. The share line includes the publisher's `shareUrl` — a new optional
  `sdkConfig` field.
- **Address autocomplete (Google Places)** — when the server configures the
  new optional `sdkConfig.placesApiKey`, the claim form's Street Address
  field suggests US addresses as the winner types (debounced, keyboard-
  navigable, "powered by Google" attribution) and a selection fills
  street/city/state/zip — every field stays hand-editable. Plain `fetch`
  against the Places API (New), no Google SDK; without a key, or on any
  network/quota failure, the address step behaves exactly as plain fields.
- **Privacy choices surface** — the how-it-works ("?") screen's Privacy
  choices link now opens a small surface (privacy-policy link + delete my
  data) instead of jumping straight to the delete confirmation; the existing
  destructive confirm is unchanged and fully reachable.
- **Adoption re-entry** — a new optional `adoptionPending` on the register
  response routes the next open to the 6-digit code screen (via the new
  `restageAdoption` callable) with a "Pick up where you left off" subtitle;
  re-entry resends go through `restageAdoption`; one-shot, cleared on
  successful verification.
- **Desktop layout (≥900px)** — conservative widening to a 600px card with a
  modest type/spacing scale-up; below 900px nothing changed.
- **Flat capture background** — the email capture screen drops its radial
  accent glow and sits on the same flat gunmetal as the streak dashboard.
- **Fixed** — the claim form's zip field clipped its digits (101px box minus
  50px of padding); now flex-basis 118px with 16px padding.
- **Note** — the cross-platform "keyboard-safe forms" item is not applicable
  on web: the browser manages viewport insets and scroll-into-view for
  focused fields, so no change was needed here.

## 2.8.0 — 2026-08-13

- Self-heal for stale local capture state: when the server reports a fresh user for this device, the cached "email submitted" flag is cleared so the capture screen shows instead of a doomed auto-claim.
- A claim refused with the email-required precondition now routes to the email capture screen instead of rendering as a connection error.
- Published bundles are minified (the `prepare` script now runs the production build).
## 2.7.0 — 2026-08-11

2.7.0 — "Verify your email" soft-verification: a persistent chip on the streak
dashboard lets users confirm a newly-typed email (reusing the code screen);
never blocks daily play, only prize-draw eligibility.

## 2.6.3 — 2026-08-11

2.6.3 — firstName/lastName are now optional on WINRUser; pass only the identity
data you have and the SDK captures the rest (email via the capture screen).

## 2.6.2 — 2026-08-11

Cross-platform SDK hardening: age-gate text honors publisher config; push
notifications functional on Android/web; resend keeps the code screen; error
screens pick up publisher branding.

- **Age gate honors server config** — the capture screen's age-gate checkbox
  no longer hardcodes "18". It now renders the publisher's server-provided
  `ageGateText` when present, and otherwise builds the sentence from
  `ageGateMinAge` ("I confirm I am {minAge} years of age or older", default
  18) via a new `ageGateText` getter on the V2 controller. The value was
  already parsed from config but went unused on this screen.
- **Push notifications** — `registerForPushNotifications()` is now gated on
  `options.enablePushReminders` (previously ignored) and no longer fires a
  bare `Notification.requestPermission()` that registered no token. Functional
  web push requires a VAPID application-server key and a service worker,
  neither shipped nor exposed as config in this build, so registration is an
  honest, logged no-op ("web push not configured") until that plumbing lands —
  rather than a permission prompt that mints an undeliverable subscription.
- **Note** — resend already keeps the code screen up, the unregistered
  impression counter already increments only after the presentability check,
  the code-error taxonomy is already three-way (expired / too-many-attempts /
  incorrect), and the empty/geo/session screens already pick up the publisher
  accent via the `--wv2-accent` CSS variable; the web SDK is the reference for
  these, so no change was needed here.

## 2.6.1 — 2026-08-11

In-experience privacy opt-out (delete my data); District of Columbia added to
the prize-claim form.

- **Privacy choices** — the how-it-works ("?") screen gains a muted "Privacy
  choices" link. It raises a destructive confirmation ("Delete my data & stop
  participating"); confirming performs the RTD opt-out against `/optOut`,
  shows "Your data has been deleted.", and dismisses the experience. Unlike
  the public `WINR.optOut()` (which deliberately silences locally even when
  the network call fails), the in-experience flow is honest: failure keeps
  the confirmation up with "Something went wrong. Please check your
  connection and try again." and marks nothing until the backend confirms.
- **District of Columbia** — the prize-claim state list already carried DC;
  it is now pinned by a regression test, per the official rules' "50 states
  and the District of Columbia".
- **Fixed** — `WINR_CONSTANTS.SDK_VERSION` (sent to the backend as
  `sdkVersion`) was stuck at 2.4.0; now 2.6.1.

## 2.6.0 — 2026-08-10

User-facing error messaging per the Master Field List; honest failure states —
no fabricated claim success; fixed raw backend strings on the code screen.

- **All V2 copy centralized** in `src/ui/v2/strings.ts` (`WINRV2Strings`) —
  one surface for copy review and future localization.
- **Inline validation messages** (shown alongside the existing CTA dimming,
  which alone explained nothing): invalid email on the capture screen; first
  name / last name / optional 10-digit phone on the winner claim form.
- **Dedicated failure states**: geo-blocked ("Not available in your
  location") and session-expired (with RETRY) instead of the generic
  "Nothing to see here yet".
- **Honest claim failures**: a failed auto-claim shows the dashboard
  UNCLAIMED with a retryable notice; a cross-device "already entered today"
  rejection shows a transient explanatory notice.
- **Code screen fixes**: backend error text is never rendered raw (fixed
  strings for expired / too-many-attempts / mismatch); a failed resend stays
  on the code screen with an inline error.
- **Email submit failures are no longer swallowed**: the capture screen stays
  up with an inline error and the user can retry.

## 2.5.1 — 2026-08-10

Consent correctness and cross-device security.

- **Marketing consent checkbox starts UNCHECKED** — consent is an affirmative
  act (pre-ticked boxes are invalid under GDPR and disfavored by US state
  regulators). Declining still blocks nothing.
- **Email pre-fill**: pass your signed-in user's email via `WINRUser.email` and
  the capture screen shows it read-only — the address the user consents for is
  always one they proved to you. Malformed values fall back to the editable
  field.
- **Guest sessions**: no account system, or the user is signed out? Use the
  guest sentinel (or omit the user on web). The SDK mints a stable per-install
  `winr_guest_…` id for attribution; re-configure with the real user later and
  the streak carries over.
- **Verified adoption**: typing an email that already belongs to an existing
  WINR account now requires a 6-digit code sent to that inbox before the
  streak transfers to the new device. Fresh signups and pre-filled partner
  emails never see it.

## [2.5.0] - 2026-08-06

### Breaking

`WINR.deleteUserData()` is **removed**. Use `WINR.optOut()`. The old call
hard-deleted entry records — the evidence a drawing was fair — left no
tombstone, and never cleaned prize-claim PII. `optOut()` is identity-wide and
complete.

### Added

Browser perimeter defence. The SDK now attaches a risk-scored reCAPTCHA
Enterprise token to device registration, closing the gap where a browser has no
hardware anchor and a script can drive signup freely.

It is **score-based**: no challenge, no puzzle, nothing the user interacts with.
The floating reCAPTCHA badge is suppressed and the required attribution appears
instead as one line in the existing legal footer.

It **never blocks the experience**. A publisher Content-Security-Policy that
forbids Google, an offline first load or a slow network all degrade to sending
no token, and registration proceeds; the backend decides what to do about that.
Enforcement is off by default while the score distribution is measured.

## [2.4.0] - 2026-08-05

Consent capture on the email screen, matching the iOS, Android and Flutter
SDKs.

### Added
- **Marketing-consent checkbox on the capture screen.** A second checkbox sits
  directly below the 18+ age gate, PRE-CHECKED, covering ONE thing: the
  publisher using the address for MARKETING email. It reads "I agree to
  receive marketing emails from this app" by default; in practice the backend
  supplies a publisher-named string via
  `sdkConfig.copy.emailCapture.emailConsentText` (or the flat legacy
  `sdkConfig.copy.emailConsentText`), and the SDK renders it verbatim — it
  never interpolates a publisher name itself. The row is built by the same
  code path as the age row, so the two are identical.
  **Declining it costs the user nothing:** the CTA is still enabled on (age
  confirmed AND valid email) alone, the entry is claimed as normal, and
  winner contact is unaffected — if this person is drawn, they are contacted
  either way. No checkbox gates that.

### Changed
- **Age confirmation is now transmitted and stored server-side.** `submitEmail`
  sends `{ email, ageConfirmed, marketingConsent }` carrying the real state of
  both checkboxes — the age gate's value used to be discarded on the client.
  `ageConfirmed` is always sent; the backend keys off it to detect a 2.4.0+
  client.

### Tests
- 5 new: the age gate renders unchecked and marketing consent renders
  pre-checked directly below it with identical styling, the copy override
  precedence (nested → flat → default), the CTA gating being untouched by the
  consent box (including unchecking it after enabling the CTA), and the
  submitted payload carrying the real `ageConfirmed`/`marketingConsent` values
  in both directions with no stray keys.

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

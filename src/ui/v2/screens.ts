import { logoNode } from './logo-cache';
import { Giveaway, GiveawayWinner, PrizeClaimBlock, AVAFLI_CONSTANTS } from '../../types';
import { V2_IMAGES } from './assets.generated';
import {
  CONFETTI_BURST_DURATION_MS,
  createAnimatedCheck,
  createConfetti,
  mountGifBurst,
  prefersReducedMotion,
} from './effects';
import {
  arrowDownIcon,
  calendarIcon,
  cameraIcon,
  checkSquareIcon,
  chevronLeftIcon,
  closeIcon,
  flameIcon,
  lockIcon,
  mailIcon,
  personIcon,
  plusIcon,
  shieldIcon,
  socialFacebookIcon,
  socialInstagramIcon,
  socialSnapchatIcon,
  socialTiktokIcon,
  socialXIcon,
  squareIcon,
  ticketIcon,
  uploadIcon,
} from './icons';
import { LegalDoc, V2ExperienceController } from './controller';
import { AvafliV2Strings } from './strings';
import {
  CLAIM_COUNTRY,
  PrizeClaimForm,
  US_STATES,
  claimDisplayName,
  claimPhotoBase64Jpeg,
  isClaimFormValid,
  isStep1Valid,
  isStep2Valid,
  isValidClaimName,
  isValidClaimPhone,
  likenessConsentText,
  monthYearDisplay,
} from './claim';
import { attachPlacesAutocomplete, stateNameFromShortCode } from './places-autocomplete';
import {
  awardedAtDisplay,
  formatInt,
  isCashPrize,
  prizeArticle,
  showsValueLine,
  stripHeadline,
} from './v2-theme';

/**
 * The V2 experience screens, ported from iOS WINRV2Screens/Components/Winner:
 * new-user capture, return-user dashboard (whose first-frame in-place reveal
 * is the ONLY celebration — there is no celebration modal), how-it-works,
 * and the winner banner/dialog. Publishers can customize ONLY: logo, prize
 * image, primary color. Everything else is hardcoded to the design or derived
 * from the prize.
 */

// ─── DOM helpers ───

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(svg: string, className: string): HTMLElement {
  const wrap = el('span', className);
  wrap.innerHTML = svg;
  return wrap;
}

// ─── Inline field errors ───

/**
 * The ONE inline field-error element (red ~13px, `.wv2-field-error`) — every
 * per-field validation message in the experience goes through here so they
 * are identical by construction. Hidden until given a message.
 */
function renderFieldError(): HTMLElement {
  return el('div', 'wv2-field-error');
}

/** Show `message` in a field-error slot, or hide the slot with null. */
function setFieldError(node: HTMLElement, message: string | null): void {
  if (message) {
    node.textContent = message;
    node.classList.add('wv2-visible');
  } else {
    node.textContent = '';
    node.classList.remove('wv2-visible');
  }
}

// ─── Drawer chrome ───

interface HeaderOptions {
  logoUrl?: string | null;
  showsBack?: boolean;
  onBack?: () => void;
  onInfo: () => void;
  onClose: () => void;
}

/** TOP UI: "?" circle • publisher logo • "X" circle. */
export function renderHeader(options: HeaderOptions): HTMLElement {
  const header = el('div', 'wv2-header');

  const left = el('button', 'wv2-circle-btn');
  if (options.showsBack) {
    left.appendChild(icon(chevronLeftIcon, 'wv2-ic'));
    (left.firstChild as HTMLElement).style.cssText = 'width:10px;height:16px';
    left.setAttribute('aria-label', 'Back');
    left.addEventListener('click', () => options.onBack?.());
  } else {
    left.appendChild(el('span', 'wv2-circle-btn-q', '?'));
    left.setAttribute('aria-label', 'How it works');
    left.addEventListener('click', () => options.onInfo());
  }
  header.appendChild(left);

  const logo = el('div', 'wv2-header-logo');
  if (options.logoUrl) {
    // Shared, pre-decoded node (see logo-cache.ts) — moving it between
    // renders keeps the logo stable instead of blinking on each re-render.
    logo.appendChild(logoNode(options.logoUrl, 'sheet'));
  } else {
    logo.appendChild(el('span', 'wv2-header-logo-fallback', 'Avafli'));
  }
  header.appendChild(logo);

  const close = el('button', 'wv2-circle-btn');
  const x = icon(closeIcon, 'wv2-ic');
  x.style.cssText = 'width:12px;height:12px';
  close.appendChild(x);
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => options.onClose());
  header.appendChild(close);

  return header;
}

/** Accent CTA pill. */
export function renderPill(
  title: string,
  onClick: () => void,
  opts: { loading?: boolean; disabled?: boolean } = {}
): HTMLButtonElement {
  const btn = el('button', 'wv2-pill');
  if (opts.loading) {
    btn.appendChild(el('span', 'wv2-spinner'));
    btn.disabled = true;
  } else {
    btn.textContent = title;
    btn.disabled = opts.disabled === true;
    if (opts.disabled) btn.classList.add('wv2-pill-dim');
  }
  btn.addEventListener('click', () => {
    if (!btn.disabled) onClick();
  });
  return btn;
}

/**
 * New-tab escape hatch. 2.9.5: legal documents NO LONGER route through here
 * (they open the in-experience overlay); the remaining callers are the
 * social share intents (X / Facebook), which genuinely belong in a new tab.
 */
function openUrl(url?: string): void {
  if (url) window.open(url, '_blank', 'noopener');
}

export function renderLegalLinks(
  c: V2ExperienceController,
  showPoweredBy = false,
  showLinksRow = true
): HTMLElement {
  const wrap = el('div', 'wv2-legal');
  // The capture screen passes showLinksRow=false: its disclaimer sentence now
  // carries the Official Rules / Privacy Policy links inline (see
  // renderLegalInlineLink), so a second links row there was pure duplication.
  // Every other surface (claim review, how-it-works, code screen) keeps the row.
  //
  // 2.9.5: both links open the IN-EXPERIENCE legal overlay (iframe) instead
  // of a new tab. The hrefs remain the real destinations so context-menu /
  // middle-click "open in new tab" still works.
  if (showLinksRow) {
    const row = el('div', 'wv2-legal-row');
    const rules = el('a', undefined, 'OFFICIAL RULES');
    rules.setAttribute('role', 'button');
    rules.href = c.rulesUrl || '#';
    rules.addEventListener('click', (e) => {
      e.preventDefault();
      c.showLegalOverlay('rules');
    });
    const privacy = el('a', undefined, 'PRIVACY POLICY');
    privacy.href = AVAFLI_CONSTANTS.PRIVACY_URL;
    privacy.addEventListener('click', (e) => {
      e.preventDefault();
      c.showLegalOverlay('privacy');
    });
    row.appendChild(rules);
    row.appendChild(el('span', 'wv2-legal-dot'));
    row.appendChild(privacy);
    wrap.appendChild(row);
  }
  // Required attribution. The reCAPTCHA badge is hidden (see perimeter.ts) — Google
  // allows that only if this notice is shown in the flow instead, so the two must
  // stay together: remove one and the other becomes non-compliant.
  const recaptcha = el('div', 'wv2-recaptcha-notice');
  recaptcha.textContent = 'Protected by reCAPTCHA — Google Privacy Policy and Terms apply';
  wrap.appendChild(recaptcha);
  if (showPoweredBy) {
    wrap.appendChild(el('div', 'wv2-powered', 'Powered by Avafli'));
  }
  return wrap;
}

/**
 * An underlined legal link embedded inside running copy (the capture screen's
 * disclaimer sentence). Same targets and behavior as the standalone links
 * row: 2.9.5, opens the in-experience legal overlay instead of a new tab.
 */
function renderLegalInlineLink(
  c: V2ExperienceController,
  label: string,
  doc: LegalDoc
): HTMLAnchorElement {
  const link = el('a', 'wv2-inline-legal', label);
  link.setAttribute('role', 'button');
  link.href = (doc === 'rules' ? c.rulesUrl : AVAFLI_CONSTANTS.PRIVACY_URL) || '#';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    c.showLegalOverlay(doc);
  });
  return link;
}

/**
 * How long the legal overlay waits for the iframe's `load` event before
 * offering the "Open in new tab" fallback. Best-effort: some publisher CSPs
 * (frame-src) block framing sdk.avafli.com, and a blocked frame may never
 * fire `load` — the timeout is the only portable signal.
 */
export const LEGAL_IFRAME_TIMEOUT_MS = 8000;

/**
 * The in-experience legal overlay (2.9.5): a full-surface layer over the
 * drawer/lightbox with a slim gunmetal header (title + X) and an iframe
 * loading the document. A loading veil covers the frame until its `load`
 * event; if that never fires within {@link LEGAL_IFRAME_TIMEOUT_MS}, the
 * veil swaps to the "Open in new tab" fallback pointing at
 * `c.legalOverlay.fallbackUrl`.
 */
export function renderLegalOverlay(c: V2ExperienceController): HTMLElement {
  const layer = el('div', 'wv2-legal-overlay');
  const overlay = c.legalOverlay;
  if (!overlay) return layer;

  const header = el('div', 'wv2-legal-overlay-header');
  header.appendChild(el('div', 'wv2-legal-overlay-title', overlay.title));
  const close = el('button', 'wv2-circle-btn');
  const x = icon(closeIcon, 'wv2-ic');
  x.style.cssText = 'width:12px;height:12px';
  close.appendChild(x);
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => c.closeLegalOverlay());
  header.appendChild(close);
  layer.appendChild(header);

  const body = el('div', 'wv2-legal-overlay-body');
  const frame = el('iframe', 'wv2-legal-overlay-frame');
  frame.src = overlay.url;
  frame.title = overlay.title;
  frame.setAttribute('referrerpolicy', 'no-referrer');
  body.appendChild(frame);

  const veil = el('div', 'wv2-legal-overlay-veil');
  veil.appendChild(el('span', 'wv2-spinner'));
  body.appendChild(veil);

  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    veil.innerHTML = '';
    veil.appendChild(
      el('div', 'wv2-legal-overlay-fallback-text', AvafliV2Strings.legalOverlayLoadFailed)
    );
    const open = el('a', 'wv2-legal-overlay-fallback-link', AvafliV2Strings.legalOverlayOpenInTab);
    open.href = overlay.fallbackUrl;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    veil.appendChild(open);
  }, LEGAL_IFRAME_TIMEOUT_MS);
  frame.addEventListener('load', () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    veil.remove();
  });

  layer.appendChild(body);
  return layer;
}

// ─── Loading / empty states ───

/**
 * Cold start (nothing cached to paint from): a SKELETON of the dashboard
 * rather than a spinner.
 *
 * The drawer auto-opens before its sequential network calls resolve
 * (registerDevice → getActiveGiveaway → claim). A bare spinner made that wait
 * read as "nothing is here yet"; blocking out the real layout — header, prize
 * card, streak tiles, come-back bar, pill — in the drawer's own gunmetal
 * reads as the content arriving, at identical latency. ONE shared pulse
 * animation keeps every block in phase so it reads as a single surface
 * breathing rather than a field of blinking rectangles. The warm path never
 * gets here at all: a cached giveaway + streak paints the real dashboard
 * immediately (see V2ExperienceController.hydrateFromCache).
 */
export function renderLoading(): HTMLElement {
  const screen = el('div', 'wv2-screen wv2-skeleton');
  const pulse = el('div', 'wv2-sk-pulse');

  pulse.appendChild(el('div', 'wv2-grabber'));

  // Header: "?" circle • logo • "X" circle.
  const header = el('div', 'wv2-sk-header');
  header.appendChild(el('div', 'wv2-sk-block wv2-sk-circle'));
  header.appendChild(el('div', 'wv2-sk-block wv2-sk-logo'));
  header.appendChild(el('div', 'wv2-sk-block wv2-sk-circle'));
  pulse.appendChild(header);

  // Prize card.
  pulse.appendChild(el('div', 'wv2-sk-block wv2-sk-card'));

  // Streak rail: three tiles.
  const rail = el('div', 'wv2-sk-rail');
  for (let i = 0; i < 3; i++) rail.appendChild(el('div', 'wv2-sk-block wv2-sk-tile'));
  pulse.appendChild(rail);

  // Come-back bar (full-bleed) + CTA pill.
  pulse.appendChild(el('div', 'wv2-sk-block wv2-sk-bar'));
  const pillWrap = el('div', 'wv2-sk-pill-wrap');
  pillWrap.appendChild(el('div', 'wv2-sk-block wv2-sk-pill'));
  pulse.appendChild(pillWrap);

  screen.appendChild(pulse);
  return screen;
}

export function renderEmpty(onClose: () => void): HTMLElement {
  const screen = el('div', 'wv2-screen');
  const center = el('div', 'wv2-center-state');
  center.appendChild(el('div', 'wv2-empty-title', 'Nothing to see here yet'));
  center.appendChild(el('div', 'wv2-empty-sub', 'Check back soon for your next chance to win!'));
  const cta = el('div', 'wv2-empty-cta');
  cta.appendChild(renderPill('CLOSE', onClose));
  center.appendChild(cta);
  screen.appendChild(center);
  return screen;
}

/**
 * Geo-fence rejection — a DEDICATED state (Master Field List), never the
 * generic empty screen: the user needs to know eligibility, not "check back
 * soon".
 */
export function renderGeoBlocked(onClose: () => void): HTMLElement {
  const screen = el('div', 'wv2-screen');
  const center = el('div', 'wv2-center-state');
  center.appendChild(el('div', 'wv2-empty-title', AvafliV2Strings.geoBlockedTitle));
  center.appendChild(el('div', 'wv2-empty-sub wv2-state-body', AvafliV2Strings.geoBlockedBody));
  const cta = el('div', 'wv2-empty-cta');
  cta.appendChild(renderPill('CLOSE', onClose));
  center.appendChild(cta);
  screen.appendChild(center);
  return screen;
}

/**
 * Token refresh failed (session expired) — a DEDICATED retryable state
 * instead of collapsing into "Nothing to see here yet". RETRY re-runs the
 * load (which re-attempts the token refresh on the next 401).
 */
export function renderSessionExpired(onRetry: () => void): HTMLElement {
  const screen = el('div', 'wv2-screen');
  const center = el('div', 'wv2-center-state');
  center.appendChild(el('div', 'wv2-empty-title wv2-state-body', AvafliV2Strings.sessionExpired));
  const cta = el('div', 'wv2-empty-cta');
  cta.appendChild(renderPill(AvafliV2Strings.retry, onRetry));
  center.appendChild(cta);
  screen.appendChild(center);
  return screen;
}

// ─── New-user capture ("VISIT. EARN. WIN.") ───

/**
 * One capture-screen consent checkbox (age gate, email consent). Both rows go
 * through here so their box, check treatment, spacing, color, text style and
 * tap target are identical by construction — style them in ONE place
 * (`.wv2-age-row`).
 */
function renderConsentRow(
  label: string,
  initialChecked: boolean,
  onToggle: (checked: boolean) => void
): HTMLButtonElement {
  let checked = initialChecked;
  const row = el('button', 'wv2-age-row');
  row.type = 'button';
  row.setAttribute('role', 'checkbox');
  row.setAttribute('aria-checked', String(checked));

  // 2.9.4 (Ryan): the boxes carry the publisher's primary color — checked is
  // an accent-filled square with a luminance-guarded contrasting check
  // (white, or gunmetal over a light primary — matching the review screen's
  // consent box and the native SDKs' checkbox guards), unchecked an
  // accent-tinted outline. currentColor drives both icon variants.
  const box = icon(checked ? checkSquareIcon : squareIcon, 'wv2-ic');
  box.style.color = 'var(--wv2-accent)';
  row.appendChild(box);
  row.appendChild(el('span', undefined, label));

  row.addEventListener('click', () => {
    checked = !checked;
    box.innerHTML = checked ? checkSquareIcon : squareIcon;
    row.setAttribute('aria-checked', String(checked));
    onToggle(checked);
  });
  return row;
}

export function renderCapture(c: V2ExperienceController, logoUrl?: string | null): HTMLElement {
  const giveaway = c.giveaway;
  const day1Entries = c.ladderValue(1);

  // 2.9: no accent glow here anymore — the capture screen shares the streak
  // dashboard drawer's flat dark background (V2_COLORS.gunmetal, carried by
  // .wv2-screen), exactly.
  const screen = el('div', 'wv2-screen');

  const scroll = el('div', 'wv2-scroll');
  const stack = el('div', 'wv2-capture-stack');

  stack.appendChild(
    renderHeader({
      logoUrl,
      onInfo: () => c.showHowItWorks(),
      onClose: () => c.requestDismiss(),
    })
  );

  const titles = el('div', 'wv2-capture-titles');
  // 2.9.4 (Ryan): "EARN." renders in the publisher's primary brand color
  // (the --wv2-accent token); VISIT. and WIN. stay white.
  const title = el('div', 'wv2-capture-title');
  title.appendChild(document.createTextNode('VISIT. '));
  title.appendChild(el('span', 'wv2-capture-title-earn', 'EARN.'));
  title.appendChild(document.createTextNode(' WIN.'));
  titles.appendChild(title);
  titles.appendChild(el('div', 'wv2-capture-sub', 'VISIT DAILY. EARN ENTRIES. WIN BIG!'));
  stack.appendChild(titles);

  stack.appendChild(renderPrizeStrip(giveaway));

  // Form
  const form = el('div', 'wv2-capture-form');

  const field = el('div', 'wv2-email-field');
  field.appendChild(icon(mailIcon, 'wv2-ic'));
  const input = el('input', 'wv2-email-input');
  input.type = 'email';
  input.placeholder = 'Enter your email address';
  input.autocomplete = 'email';
  input.setAttribute('autocapitalize', 'none');
  input.setAttribute('autocorrect', 'off');
  // Partner-authenticated pre-fill: shown READ-ONLY so the user sees exactly
  // which address they are consenting for but cannot swap in someone else's
  // (accounts merge across devices by email). readOnly, not disabled — a
  // disabled input is skipped by screen readers and excluded from form
  // semantics; this one must stay perceivable.
  const lockedEmail = c.prefilledEmail;
  if (lockedEmail) {
    input.value = lockedEmail;
    input.readOnly = true;
    input.setAttribute('aria-label', 'Email provided by this app');
    input.classList.add('wv2-email-locked');
    field.appendChild(input);
    field.appendChild(icon(lockIcon, 'wv2-ic-lock'));
  } else {
    field.appendChild(input);
  }
  form.appendChild(field);

  // Inline "Please enter a valid email address." — shown only after the
  // field is TOUCHED (blurred once with a non-empty invalid value) or after
  // a submit attempt; never while the user is typing their first characters.
  // Once showing, it live-clears the moment the address becomes valid.
  const emailError = renderFieldError();
  form.appendChild(emailError);

  const isValidEmail = (): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
  let showEmailError = false;
  const syncEmailError = (): void => {
    setFieldError(emailError, showEmailError && !isValidEmail() ? AvafliV2Strings.emailInvalid : null);
  };

  // Two consent checkboxes, built by the same helper so they are identical in
  // every visual respect. The age gate starts UNCHECKED (affirmative action
  // required) and gates the CTA; MARKETING consent starts CHECKED and never
  // does — declining it costs the user neither their entry nor, if they are
  // drawn, their winner contact.
  let isAdult = false;
  let wantsMarketing = false;

  const canSubmit = (): boolean => isAdult && isValidEmail();

  const refreshCta = (): void => {
    cta.disabled = !canSubmit() || c.isSubmittingEmail;
    cta.classList.toggle('wv2-pill-dim', !canSubmit());
  };

  form.appendChild(
    renderConsentRow(c.ageGateText, false, (checked) => {
      isAdult = checked;
      refreshCta();
    })
  );
  form.appendChild(
    // Unchecked by default: consent must be an affirmative act (pre-ticked boxes
    // are invalid under GDPR and disfavored by US state regulators).
    renderConsentRow(c.marketingConsentText, false, (checked) => {
      wantsMarketing = checked;
    })
  );

  const submit = (): void => {
    void c.submitEmail(input.value.trim(), {
      ageConfirmed: isAdult,
      marketingConsent: wantsMarketing,
    });
  };

  const cta = renderPill(`CLAIM MY ${day1Entries} ENTRIES`, submit, {
    loading: c.isSubmittingEmail,
    disabled: !canSubmit(),
  });
  // The dimming alone told users nothing (the audit's core finding) — a tap
  // on the dimmed CTA counts as a submit attempt and surfaces WHY. The
  // disabled pill lets the click through to this wrapper via CSS
  // (pointer-events: none on :disabled).
  const ctaWrap = el('div', 'wv2-cta-catch');
  ctaWrap.appendChild(cta);
  ctaWrap.addEventListener('click', () => {
    if (!cta.disabled || c.isSubmittingEmail) return;
    showEmailError = true;
    syncEmailError();
  });
  form.appendChild(ctaWrap);

  // The email submit itself failed (controller kept us on this screen) —
  // same field-error component, below the CTA, until the retry succeeds.
  const submitError = renderFieldError();
  setFieldError(submitError, c.emailSubmitError);
  form.appendChild(submitError);

  stack.appendChild(form);

  input.addEventListener('input', () => {
    refreshCta();
    syncEmailError();
  });
  input.addEventListener('blur', () => {
    if (input.value.trim() !== '' && !isValidEmail()) showEmailError = true;
    syncEmailError();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (canSubmit()) {
      submit();
    } else {
      // An Enter press is a submit attempt — explain instead of ignoring.
      showEmailError = true;
      syncEmailError();
    }
  });

  // Legal footer — anchored to the BOTTOM of the drawer/card (margin-top:auto
  // inside the min-height:100% stack, see .wv2-capture-legal) so it never sits
  // congested under the CTA; on short viewports the auto margin collapses and
  // the block degrades to normal scrollable flow. The disclaimer sentence
  // carries the Official Rules / Privacy Policy links INLINE (underlined, same
  // targets and overlay behavior as the links row) — the separate
  // "OFFICIAL RULES • PRIVACY POLICY" row was a duplicate here and is removed
  // from this screen only. renderLegalLinks still contributes the reCAPTCHA
  // attribution (required while the badge is hidden — see perimeter.ts) and
  // the Powered-by line.
  const legal = el('div', 'wv2-capture-legal');
  const disclaimer = el('div', 'wv2-capture-disclaimer');
  disclaimer.appendChild(
    document.createTextNode(
      'Your email lets us contact you if you win. By entering you agree to the '
    )
  );
  disclaimer.appendChild(renderLegalInlineLink(c, 'Official Rules', 'rules'));
  disclaimer.appendChild(document.createTextNode(' & '));
  disclaimer.appendChild(renderLegalInlineLink(c, 'Privacy Policy', 'privacy'));
  legal.appendChild(disclaimer);
  legal.appendChild(renderLegalLinks(c, true, false));
  stack.appendChild(legal);

  scroll.appendChild(stack);
  screen.appendChild(scroll);
  return screen;
}

/**
 * PRIZE-derived white strip (Joe's Day-1 examples):
 * cash → "$1,000.00 CASH PRIZE"; other → "Win a $500 Amazon Gift Card" + value.
 */
function renderPrizeStrip(giveaway: Giveaway | null): HTMLElement {
  const description = giveaway?.prizeDescription ?? '';
  const value = Math.round(giveaway?.prizeValue ?? 0);
  const strip = el('div', 'wv2-prize-strip');
  if (isCashPrize(description)) {
    strip.appendChild(el('div', 'wv2-prize-strip-cash', `$${formatInt(value)}.00 CASH PRIZE`));
  } else {
    strip.appendChild(
      el('div', 'wv2-prize-strip-title', `Win ${prizeArticle(description, false)} ${description}`)
    );
    if (showsValueLine(description, value)) {
      strip.appendChild(el('div', 'wv2-prize-strip-value', `$${formatInt(value)}.00 Value!`));
    }
  }
  return strip;
}

// ─── Return-user dashboard (Day 2+ drawer) ───

/** How long the "YOU'RE ON A ROLL!" toast holds before its single slide to the pitch. */
export const COMEBACK_TOAST_HOLD_MS = 2500;

/**
 * The persistent "Verify your email" chip (soft email verification). A subtle,
 * accent-tinted pill with a mail icon — tappable, non-blocking, and it never
 * covers the streak content. Shown on the dashboard while `c.unverified`.
 */
export function renderVerifyChip(onTap: () => void): HTMLButtonElement {
  const chip = el('button', 'wv2-verify-chip');
  chip.type = 'button';
  chip.appendChild(icon(mailIcon, 'wv2-verify-chip-ic'));
  chip.appendChild(el('span', 'wv2-verify-chip-text', AvafliV2Strings.verifyEmailChip));
  chip.setAttribute('aria-label', AvafliV2Strings.verifyEmailChip);
  chip.addEventListener('click', onTap);
  return chip;
}

export function renderDashboard(
  c: V2ExperienceController,
  logoUrl: string | null | undefined,
  onWinnerTap: () => void
): HTMLElement {
  // Day 2+ reveal flow: the celebration is the dashboard's FIRST VISIBLE
  // FRAME — the controller staged a PREDICTED grant straight from the
  // pre-claim status response, the toast is the bar's first visible state,
  // and the tile/count-up celebration fires one short beat (~0.15s) after
  // mount, with the real claim reconciling silently in the background. The
  // pill reads GOT IT the whole time — no claim click, no modal. The tile
  // and stat numbers hold yesterday's values for that one beat so the flip
  // reads as motion, never as a flash of raw post-claim state.
  const preReveal = !c.claimRevealed && (c.pendingRevealGrant !== null || !c.claimedToday);

  // CACHE-FIRST FRAME: painted from cached values before any network response,
  // so there is no staged grant behind it. It must show the cached numbers
  // AS-IS (nothing pinned to N-1 for a celebration that hasn't been staged)
  // while today's tile rests calm — `ready`, so no check, no confetti and no
  // burst GIF fire here and the real celebration still plays exactly once when
  // the claim lands.
  const cacheFrame = c.hydratedFromCache && !c.pendingRevealGrant && !c.claimRevealed;

  const screen = el('div', 'wv2-screen');

  const top = el('div', 'wv2-dash-stack');
  top.appendChild(el('div', 'wv2-grabber'));
  top.appendChild(
    renderHeader({
      logoUrl,
      onInfo: () => c.showHowItWorks(),
      onClose: () => c.requestDismiss(),
    })
  );
  screen.appendChild(top);

  const scroll = el('div', 'wv2-scroll');
  scroll.style.marginTop = '15px';
  const body = el('div', 'wv2-dash-body');

  // Winner banner: server-flag-gated, DEFAULT HIDDEN (Aug 31 GTM decision —
  // keeps the GOT IT button above the fold on mobile). Renders only when
  // `sdkConfig.experience.winnerBannerEnabled` is exactly true AND a
  // latestWinner exists. Hidden ⇒ the winner-feed modal has no entry point,
  // which is intended (it's the banner's child). The row is simply omitted;
  // `.wv2-dash-body` spaces children via flex `gap`, so no orphan margin.
  if (c.giveaway?.latestWinner && c.sdkConfig?.experience?.winnerBannerEnabled === true) {
    body.appendChild(renderWinnerBanner(onWinnerTap));
  }

  // ─── Non-blocking dashboard notices (Master Field List) ───
  // Two kinds share the slot above the prize card:
  //  - claim-failure notice (persistent, retryable): the auto-claim didn't
  //    land, the dashboard shows honest UNCLAIMED state, and tapping the
  //    notice (or its RETRY) re-attempts the claim.
  //  - transient notice ("You've already entered today…"): one-shot, fades
  //    out on its own after a few seconds.
  const noticeSlot = el('div', 'wv2-notice-slot');
  body.appendChild(noticeSlot);
  const syncNotices = (): void => {
    noticeSlot.innerHTML = '';
    if (c.claimFailedNotice) {
      const notice = el('button', 'wv2-dash-notice wv2-dash-notice-retry');
      notice.type = 'button';
      notice.appendChild(el('span', 'wv2-dash-notice-text', AvafliV2Strings.claimRecordFailed));
      notice.appendChild(el('span', 'wv2-dash-notice-action', AvafliV2Strings.retry));
      notice.addEventListener('click', () => void c.retryClaim());
      noticeSlot.appendChild(notice);
      return;
    }
    const transient = c.dashboardNotice;
    if (transient) {
      c.dashboardNotice = null; // one-shot — never replays on a later open
      const notice = el('div', 'wv2-dash-notice', transient);
      noticeSlot.appendChild(notice);
      window.setTimeout(() => {
        if (!notice.isConnected) return;
        notice.classList.add('wv2-notice-fade');
        window.setTimeout(() => notice.remove(), 450);
      }, 6000);
    }
  };
  syncNotices();

  // Soft email-verification nudge: a persistent, non-blocking pill shown while
  // the backend reports this email as unverified. Sits near the top (under the
  // header, above the prize card) so it reads as a gentle nudge — it never
  // covers the streak content and never gates play. Tapping opens the reused
  // 6-digit code screen.
  if (c.unverified) {
    body.appendChild(renderVerifyChip(() => c.showEmailVerify()));
  }

  body.appendChild(renderPrizeCard(c, preReveal && !cacheFrame));
  body.appendChild(renderStreakRail(c, preReveal || cacheFrame));
  body.appendChild(renderComeBackBar(c));

  const footer = el('div', 'wv2-dash-footer');
  const pillWrap = el('div', 'wv2-pill-wrap');

  const noun = c.visitMode ? 'VISIT' : 'DAY';
  const preClaimTotal = c.preClaimTotalEntries ?? c.totalEntries;

  /**
   * The auto-reveal celebration, animated in place (no re-render, so the
   * draw-on check and the count-up run against the already-visible
   * dashboard). Fired by the controller's scheduleAutoReveal() timer on
   * first mount:
   *  - today's tile flips ready → active (draw-on check + confetti field +
   *    one-shot confetti-burst GIF overflowing the tile)
   *  - the streak label advances N-1 → N
   *  - the total animates up to the (predicted) post-claim value
   *  - the toast's slide to the come-back pitch is scheduled (the toast has
   *    been visible since mount)
   * The pill is untouched — it reads GOT IT throughout and only dismisses.
   * Guarded + one-shot, so a re-arm or re-render can't double-mutate.
   */
  const doReveal = (): void => {
    if (!c.pendingRevealGrant || c.claimRevealed) return;
    c.revealClaim();

    const tile = screen.querySelector('.wv2-tile.wv2-ready');
    if (tile) {
      tile.classList.remove('wv2-ready');
      tile.classList.add('wv2-active');
      // The full active-tile lockup lands on this same render pass: the
      // draw-on check in the icon slot, the falling-confetti field around
      // the tile, the pulsing glow (CSS), and the one-shot confetti-burst
      // GIF overflowing the tile (see mountTileBurst).
      const iconWrap = tile.querySelector('.wv2-tile-icon');
      if (iconWrap) {
        iconWrap.innerHTML = '';
        iconWrap.appendChild(createAnimatedCheck(12));
      }
      const box = tile.parentElement;
      if (box) {
        const confetti = createConfetti({ style: 'celebration', count: 12, speed: 0.7 });
        confetti.classList.add('wv2-tile-confetti');
        box.insertBefore(confetti, tile);
        mountTileBurst(box);
      }
    }

    const streakNum = screen.querySelector('.wv2-stat-streak');
    if (streakNum) streakNum.textContent = `${c.streakDay} ${noun} STREAK`;

    // Total Entries counts up (~0.7s ease-out) and pops Joe's one-shot
    // Figma confetti-burst GIF as it lands on the final number; the guarded
    // timeout inside mountGifBurst removes it after the GIF's full run.
    const totalNum = screen.querySelector('.wv2-stat-total');
    if (totalNum) {
      animateCount(totalNum as HTMLElement, preClaimTotal, c.totalEntries, 700, () => {
        if (!totalNum.isConnected) return;
        mountGifBurst({
          parent: totalNum as HTMLElement,
          src: V2_IMAGES.confettiBurst,
          className: 'wv2-count-burst',
          durationMs: CONFETTI_BURST_DURATION_MS,
        });
      });
    }

    // The "YOU'RE ON A ROLL!" toast has been the bar's FIRST visible state
    // since mount (.wv2-toast-start — never the pitch first on a celebration
    // open); after the ~2.5s hold it slides ONCE to the come-back pitch, the
    // bar's final resting state.
    const comeback = screen.querySelector('.wv2-comeback') as HTMLElement | null;
    if (comeback) {
      // Usually a no-op (the toast was seeded at mount). It matters when the
      // dashboard was painted from CACHE before the claim was staged: the
      // celebration arrived late, and the toast has to start now — once.
      startComeBackToast(comeback);
      window.setTimeout(() => {
        // Teardown-safe: no-op if the dashboard was dismissed mid-hold.
        if (!comeback.isConnected) return;
        comeback.classList.remove('wv2-toast-start');
        comeback.classList.add('wv2-untoasting');
      }, COMEBACK_TOAST_HOLD_MS);
    }
  };

  // Register the in-place celebration with the controller's auto-reveal
  // timer (armed when the dashboard state is entered with a predicted
  // grant). Latest render wins, so the mutation always targets the DOM
  // currently on screen.
  c.onAutoReveal = doReveal;

  // Silent reconcile: the background claim landed (or settled after a
  // failure) and the controller's numbers are now server truth — update the
  // on-screen streak label + total in place, with no second celebration.
  c.onRevealReconcile = (): void => {
    if (!screen.isConnected || !c.claimRevealed) return;
    // The background claim may have FAILED after the celebration played —
    // surface the retryable notice in place (honest failure, no silent
    // fabricated success) alongside the quiet totals settle below.
    syncNotices();
    const streakNum = screen.querySelector('.wv2-stat-streak');
    if (streakNum) streakNum.textContent = `${c.streakDay} ${noun} STREAK`;
    const totalNum = screen.querySelector('.wv2-stat-total');
    if (totalNum) {
      // Only the leading text node — never wipe a mounted count-burst img.
      const setTotal = (): void => {
        const first = totalNum.firstChild;
        if (first && first.nodeType === Node.TEXT_NODE) {
          first.nodeValue = formatInt(c.totalEntries);
        } else if (totalNum.childElementCount === 0) {
          totalNum.textContent = formatInt(c.totalEntries);
        }
      };
      setTotal();
      // The reveal's count-up may still be running toward the predicted
      // total; settle once more after it lands (guarded against teardown).
      window.setTimeout(() => {
        if (totalNum.isConnected) setTotal();
      }, 750);
    }
  };

  // Always GOT IT (Slice prototype) — the celebration plays on its own; the
  // pill only ever closes.
  const pill = renderPill('GOT IT', () => c.requestDismiss());
  pillWrap.appendChild(pill);
  footer.appendChild(pillWrap);
  footer.appendChild(renderLegalLinks(c));
  body.appendChild(footer);

  scroll.appendChild(body);
  screen.appendChild(scroll);
  return screen;
}

/** rAF count-up for the total-entries stat during the reveal. */
function animateCount(
  node: HTMLElement,
  from: number,
  to: number,
  durationMs: number,
  onLand?: () => void
): void {
  if (typeof requestAnimationFrame !== 'function' || from === to) {
    node.textContent = formatInt(to);
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    node.textContent = formatInt(from + (to - from) * eased);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      onLand?.();
    }
  };
  requestAnimationFrame(step);
}

/**
 * Day 2+ prize card (Joe's Aug-2026 dark full-bleed revision): the prize art
 * fills the WHOLE card, a solid black stats strip (streak + total entries)
 * sits inside the top edge, and the prize-derived headline rides the bottom
 * over a black→transparent scrim. The image is publisher-configurable
 * (prizeImageUrl); default is the bundled cash pile.
 */
function renderPrizeCard(c: V2ExperienceController, preReveal = false): HTMLElement {
  const giveaway = c.giveaway;
  const description = giveaway?.prizeDescription ?? '';
  const value = Math.round(giveaway?.prizeValue ?? 0);
  const noun = c.visitMode ? 'VISIT' : 'DAY';

  // Pre-reveal, the card is pinned to YESTERDAY's numbers: streak label N-1
  // and the pre-claim total. The auto-reveal advances both (see doReveal).
  const displayStreakDay = preReveal ? Math.max(c.streakDay - 1, 1) : c.streakDay;
  const displayTotal = preReveal ? (c.preClaimTotalEntries ?? c.totalEntries) : c.totalEntries;

  const card = el('div', 'wv2-prize-card');

  // Full-bleed hero art.
  card.appendChild(renderPrizeHero(giveaway?.prizeImageUrl));

  // Solid black stats strip inside the top edge: accent title + white sub.
  const strip = el('div', 'wv2-stats-strip');
  const streakStat = el('div', 'wv2-stat');
  streakStat.appendChild(icon(flameIcon, 'wv2-ic-flame'));
  const streakCol = el('div', 'wv2-stat-col');
  streakCol.appendChild(
    el('div', 'wv2-stat-num wv2-stat-streak', `${displayStreakDay} ${noun} STREAK`)
  );
  streakCol.appendChild(el('div', 'wv2-stat-label', 'Keep it going!'));
  streakStat.appendChild(streakCol);
  strip.appendChild(streakStat);

  const entriesStat = el('div', 'wv2-stat');
  entriesStat.appendChild(icon(ticketIcon, 'wv2-ic-ticket'));
  const entriesCol = el('div', 'wv2-stat-col');
  entriesCol.appendChild(el('div', 'wv2-stat-num wv2-stat-total', formatInt(displayTotal)));
  entriesCol.appendChild(el('div', 'wv2-stat-label', 'Total Entries'));
  entriesStat.appendChild(entriesCol);
  strip.appendChild(entriesStat);
  card.appendChild(strip);

  // Prize headline over the bottom black→transparent scrim.
  const headline = el('div', 'wv2-prize-headline');
  if (isCashPrize(description)) {
    // "WIN $1,000" over "CASH PRIZE", right-aligned.
    const lockup = el('div', 'wv2-ph-cash');
    lockup.appendChild(el('div', 'wv2-ph-cash-win', `WIN $${formatInt(value)}`));
    lockup.appendChild(el('div', 'wv2-ph-cash-sub', 'CASH PRIZE'));
    headline.appendChild(lockup);
  } else {
    // Centered "Win a {Prize}" + accent "$X.00 VALUE!".
    const lockup = el('div', 'wv2-ph-prize');
    lockup.appendChild(
      el('div', 'wv2-ph-prize-title', `Win ${prizeArticle(description, false)} ${description}`)
    );
    if (showsValueLine(description, value)) {
      lockup.appendChild(el('div', 'wv2-ph-prize-value', `$${formatInt(value)}.00 VALUE!`));
    }
    headline.appendChild(lockup);
  }
  card.appendChild(headline);
  return card;
}

/**
 * The prize card's full-bleed hero.
 *
 * The publisher's `prizeImageUrl` is normally already decoded by
 * {@link prewarmImage} (warmed the moment the SDK learned the giveaway
 * config), in which case the <img> reports `complete` synchronously and
 * paints with the rest of the card — no fade, no placeholder beat. A COLD URL
 * fades in over ~200ms against the card's deep-charcoal background (never a
 * blank/white flash), and a broken one falls back to the bundled cash hero.
 */
export function renderPrizeHero(prizeImageUrl?: string | null): HTMLImageElement {
  const hero = el('img', 'wv2-prize-hero');
  hero.alt = '';

  if (!prizeImageUrl) {
    hero.src = V2_IMAGES.cashHero; // bundled data URI — always instant
    return hero;
  }

  hero.src = prizeImageUrl;
  // Prewarmed: assigning a src that is already in the browser's list of
  // available images resolves SYNCHRONOUSLY, so the bytes are here and the
  // hero paints with the rest of the card — no fade, no placeholder beat.
  if (hero.complete && hero.naturalWidth > 0) return hero;

  hero.classList.add('wv2-img-fade');
  let settled = false;
  const onLoad = (): void => {
    if (settled) return;
    settled = true;
    hero.classList.add('wv2-img-ready');
  };
  const onError = (): void => {
    if (settled) return;
    settled = true;
    // Broken publisher URL — swap in the bundled cash hero, unfaded. The
    // load handler stands down so the swap can't re-trigger the fade.
    hero.classList.remove('wv2-img-fade', 'wv2-img-ready');
    hero.src = V2_IMAGES.cashHero;
  };
  hero.addEventListener('load', onLoad);
  hero.addEventListener('error', onError, { once: true });
  return hero;
}

// ─── Streak rail (STREAK STEP + MILESTONE tiles) ───

function renderStreakRail(c: V2ExperienceController, preReveal = false): HTMLElement {
  const rail = el('div', 'wv2-rail');
  const noun = c.visitMode ? 'VISIT' : 'DAY';
  const streakDay = c.streakDay;
  const maxDay = Math.max(31, streakDay + 2);
  const milestoneDays = new Map<number, number>();
  for (const m of c.giveaway?.milestones ?? []) milestoneDays.set(m.day, m.bonusEntries);

  let activeItem: HTMLElement | null = null;

  for (let day = 1; day <= maxDay; day++) {
    const state: TileState =
      day < streakDay
        ? 'completed'
        : day === streakDay
          ? preReveal
            ? 'ready'
            : 'active'
          : 'locked';

    const item = el('div', 'wv2-rail-item');
    if (day === streakDay) item.classList.add('wv2-current');

    // The "DAILY PROGRESS ▾" pointer rides ABOVE the current tile and scrolls
    // with it.
    const pointer = el('div', 'wv2-pointer');
    pointer.appendChild(
      el('div', 'wv2-pointer-label', c.visitMode ? 'PROGRESS' : 'DAILY PROGRESS')
    );
    pointer.appendChild(icon(arrowDownIcon, 'wv2-ic'));
    item.appendChild(pointer);

    item.appendChild(renderStreakTile(day, c.ladderValue(day), state, noun));
    rail.appendChild(item);
    if (day === streakDay) activeItem = item;

    const bonus = milestoneDays.get(day);
    if (bonus !== undefined) {
      let label: string;
      switch (day) {
        case 7: label = '1 WEEK'; break;
        case 14: label = '2 WEEK'; break;
        case 21: label = '3 WEEK'; break;
        case 29:
        case 30: label = '1 MONTH'; break;
        default: label = `DAY ${day}`;
      }
      const footnote =
        day === streakDay ? 'STARTING TOMORROW' : `STARTING AT ${noun} ${day + 1}`;
      const powerItem = el('div', 'wv2-rail-item');
      const spacer = el('div', 'wv2-pointer');
      spacer.appendChild(el('div', 'wv2-pointer-label', ' '));
      powerItem.appendChild(spacer);
      powerItem.appendChild(renderPowerUpTile(label, bonus, footnote));
      rail.appendChild(powerItem);
    }
  }

  // Center the active tile once mounted (mirrors iOS's delayed scrollTo).
  setTimeout(() => {
    if (activeItem && activeItem.isConnected) {
      const left =
        activeItem.offsetLeft - rail.clientWidth / 2 + activeItem.clientWidth / 2;
      rail.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }, 350);

  attachRailScrolling(rail);
  return rail;
}

/**
 * `ready` = today's tile before the auto-reveal fires (claim already granted
 * server-side, celebration pending): glows like `active` but shows only the
 * glowing number — no icon, no confetti specks (the check draws in at the
 * reveal).
 */
type TileState = 'completed' | 'active' | 'ready' | 'locked';

/**
 * The reveal-beat explosion on the active tile: Joe's one-shot Figma
 * confetti-burst GIF, ~200x200 centered on the 106x134 tile so it overflows
 * the tile bounds, layered over the drawn check + falling-confetti field +
 * pulsing glow. A fresh <img> per mount restarts the GIF at frame 0; the
 * removal after its full run is teardown-guarded inside mountGifBurst.
 */
function mountTileBurst(box: HTMLElement): void {
  mountGifBurst({
    parent: box,
    src: V2_IMAGES.confettiBurst,
    className: 'wv2-tile-burst',
    durationMs: CONFETTI_BURST_DURATION_MS,
  });
}

function renderStreakTile(
  day: number,
  entries: number,
  state: TileState,
  noun: string
): HTMLElement {
  const box = el('div', 'wv2-tile-box');
  const tile = el('div', `wv2-tile wv2-${state}`);

  tile.appendChild(el('div', 'wv2-tile-day', day >= 31 ? `${noun} 31 +` : `${noun} ${day}`));

  const mid = el('div', 'wv2-tile-mid');
  mid.appendChild(el('div', 'wv2-tile-num', formatInt(entries)));
  mid.appendChild(el('div', 'wv2-tile-entries', 'ENTRIES'));
  tile.appendChild(mid);

  const iconWrap = el('div', 'wv2-tile-icon');
  if (state === 'completed') {
    const img = el('img');
    img.src = V2_IMAGES.checkCompleted;
    img.alt = '';
    iconWrap.appendChild(img);
  } else if (state === 'active') {
    iconWrap.appendChild(createAnimatedCheck(12)); // 2.5pt at 20px ≈ 12/100 viewBox units
  } else if (state === 'ready') {
    // Joe's frames: the current tile pre-check shows ONLY the glowing
    // number — no icon. The .wv2-tile-icon slot keeps its 24x24 size so the
    // check can draw into place without the card resizing.
  } else {
    iconWrap.appendChild(icon(lockIcon, 'wv2-ic-lock'));
  }
  tile.appendChild(iconWrap);

  if (state === 'active') {
    // Joe's active-tile motion: breathing glow (CSS) + confetti specks
    // scattered around the tile — the tile's RESTING celebrated state.
    const confetti = createConfetti({ style: 'celebration', count: 12, speed: 0.7 });
    confetti.classList.add('wv2-tile-confetti');
    box.appendChild(confetti);
  }
  box.appendChild(tile);
  // NOTE (iOS parity): the one-shot confetti-burst GIF is NOT mounted here.
  // It belongs to the single reveal beat (doReveal's ready → active flip) —
  // a tile that MOUNTS as `active` (already-claimed reopen, back-nav from
  // how-it-works, a server-mismatch repaint) must not replay the explosion.
  return box;
}

/** The joined "STREAK BONUS!" accelerator tile (Figma MILESTONE TILE). */
function renderPowerUpTile(label: string, bonus: number, footnote: string): HTMLElement {
  const tile = el('div', 'wv2-powerup');
  tile.appendChild(icon(flameIcon, 'wv2-ic-flame'));
  const body = el('div', 'wv2-powerup-body');
  body.appendChild(el('div', 'wv2-powerup-label', `${label}\nSTREAK BONUS!`));
  const nums = el('div');
  nums.appendChild(el('div', 'wv2-powerup-bonus', `+${bonus}`));
  nums.appendChild(el('div', 'wv2-powerup-every', 'EVERY DAY!'));
  body.appendChild(nums);
  body.appendChild(el('div', 'wv2-powerup-footnote', footnote));
  tile.appendChild(body);
  return tile;
}

/** Mouse-wheel + drag scrolling for the rail (hidden scrollbars). */
function attachRailScrolling(rail: HTMLElement): void {
  rail.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        rail.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false }
  );

  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return; // touch uses native scrolling
    dragging = true;
    startX = e.clientX;
    startScroll = rail.scrollLeft;
    rail.classList.add('wv2-dragging');
    rail.setPointerCapture(e.pointerId);
  });
  rail.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rail.scrollLeft = startScroll - (e.clientX - startX);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove('wv2-dragging');
    try {
      rail.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };
  rail.addEventListener('pointerup', endDrag);
  rail.addEventListener('pointercancel', endDrag);
}

// ─── Confirmation ("come back tomorrow") bar ───

/**
 * ONE-SHOT toast starter for the come-back bar.
 *
 * The toast used to be seeded only at render time, from
 * `pendingRevealGrant && !claimRevealed`. Now that the dashboard can be
 * painted from CACHE before the claim is staged, the bar can mount before
 * there is anything to celebrate — and a celebration staged a moment later
 * would have been silently dropped. This lets the toast arrive LATE, while
 * the `data-toast-played` marker guarantees it plays exactly once: seeded at
 * mount OR arriving late, never twice.
 *
 * Returns true if this call is what started the toast.
 */
export function startComeBackToast(bar: HTMLElement): boolean {
  if (bar.dataset['toastPlayed'] === '1') return false;
  bar.dataset['toastPlayed'] = '1';
  bar.classList.add('wv2-toast-start');
  return true;
}

function renderComeBackBar(c: V2ExperienceController): HTMLElement {
  // On a CELEBRATION open the toast ("YOU'RE ON A ROLL!") is the bar's FIRST
  // visible state — never the pitch first — and it slides ONCE to the pitch
  // after the ~2.5s hold (see doReveal + .wv2-toast-start/.wv2-untoasting).
  // Every other open rests on the come-back pitch with no toast replay.
  const claimedEntries = c.pendingRevealGrant
    ? c.pendingRevealGrant.baseEntries + c.pendingRevealGrant.bonusEntries
    : c.ladderValue(c.streakDay);

  const bar = el('div', 'wv2-comeback');
  if (c.pendingRevealGrant && !c.claimRevealed) startComeBackToast(bar);

  // Come-back pitch (the resting state). "Come back tomorrow"/"Come back
  // again" is BOLD, the rest regular — per Joe's banner lockup.
  const come = el('div', 'wv2-cb-come');
  come.appendChild(icon(calendarIcon, 'wv2-ic-cal'));
  const col = el('div', 'wv2-comeback-col');
  const line = el('div', 'wv2-comeback-line');
  line.appendChild(el('strong', undefined, c.visitMode ? 'Come back again' : 'Come back tomorrow'));
  line.appendChild(
    document.createTextNode(
      c.visitMode ? ' to receive:' : ' to\nkeep your streak alive and receive:'
    )
  );
  col.appendChild(line);
  col.appendChild(el('div', 'wv2-comeback-entries', `${formatInt(c.nextEntries)} ENTRIES`));
  come.appendChild(col);
  bar.appendChild(come);

  // Claimed celebration toast: headline + "your entries landed" subline.
  // Day 1 (post-claim streak 1) greets with "YOU'RE IN!" — Day 2+ keeps the
  // streak headline. The subline is the same either way.
  const done = el('div', 'wv2-cb-claimed');
  const check = el('div', 'wv2-cb-check');
  check.appendChild(createAnimatedCheck(9)); // 3.5pt at 38px ≈ 9/100 viewBox units
  done.appendChild(check);
  const doneCol = el('div', 'wv2-cb-claimed-col');
  doneCol.appendChild(
    el('div', 'wv2-cb-added', c.streakDay <= 1 ? 'YOU’RE IN!' : 'YOU’RE ON A ROLL!')
  );
  doneCol.appendChild(
    el(
      'div',
      'wv2-cb-roll',
      `Your ${formatInt(claimedEntries)} entries have been added automatically.`
    )
  );
  done.appendChild(doneCol);
  bar.appendChild(done);

  // Joe's toast has celebratory sprinkles drifting over the reward line.
  bar.appendChild(createConfetti({ style: 'celebration', count: 10, speed: 0.55 }));
  return bar;
}

// ─── How it works ───

export function renderHowItWorks(c: V2ExperienceController, logoUrl?: string | null): HTMLElement {
  const screen = el('div', 'wv2-screen wv2-hiw');
  const visitMode = c.visitMode;
  const day1Entries = c.ladderValue(1);

  const stack = el('div', 'wv2-hiw-stack');
  stack.appendChild(
    renderHeader({
      logoUrl,
      showsBack: true,
      onBack: () => c.hideHowItWorks(),
      onInfo: () => {},
      onClose: () => c.requestDismiss(),
    })
  );
  stack.appendChild(el('div', 'wv2-hiw-strip', 'HOW IT WORKS'));
  screen.appendChild(stack);

  const scroll = el('div', 'wv2-scroll');
  scroll.style.marginTop = '12px';

  const items = el('div', 'wv2-hiw-items');
  const item = (num: string, title: string, body: string): HTMLElement => {
    const row = el('div', 'wv2-hiw-item');
    row.appendChild(el('div', 'wv2-hiw-item-num', `${num}.`));
    const col = el('div', 'wv2-hiw-item-col');
    col.appendChild(el('div', 'wv2-hiw-item-title', title));
    col.appendChild(el('div', 'wv2-hiw-item-body', body));
    row.appendChild(col);
    return row;
  };
  items.appendChild(
    item(
      '1',
      'ENTER ONCE',
      `Submit your email to receive ${day1Entries} entries instantly and start your streak.`
    )
  );
  items.appendChild(
    item(
      '2',
      visitMode ? 'KEEP VISITING' : 'VISIT EVERY DAY',
      visitMode
        ? 'Simply open the app whenever you like. Your entries are added automatically—no forms or extra steps.'
        : 'Simply open the app each day. Your entries are added automatically—no forms or extra steps.'
    )
  );
  items.appendChild(
    item(
      '3',
      'KEEP YOUR STREAK GROWING',
      visitMode
        ? 'Earn more entries with every visit. The more you come back, the bigger your rewards!'
        : 'Earn more entries with every consecutive visit. The longer your streak, the bigger your daily rewards!'
    )
  );
  scroll.appendChild(items);

  scroll.appendChild(
    el(
      'div',
      'wv2-hiw-tagline',
      visitMode
        ? 'Every visit counts - your streak never resets.'
        : 'Don’t miss a day - your streak resets if you do.'
    )
  );

  const cta = el('div', 'wv2-hiw-cta');
  cta.appendChild(renderPill('GOT IT - START MY STREAK', () => c.hideHowItWorks()));
  scroll.appendChild(cta);

  // 2.9.5 (Ryan's review): the muted "Privacy choices" fine-print link that
  // sat below the CTA is REMOVED — the legal-links row (dashboard, code
  // screen) and the capture screen's inline disclaimer links keep the
  // privacy page (and its "Delete my data" section) findable, so a third
  // entry point here was redundant.

  screen.appendChild(scroll);
  return screen;
}

/**
 * The destructive "Delete my data & stop participating" confirmation (plus
 * its in-flight / failed / deleted states) — same scrim-plus-card treatment
 * as the winners dialog.
 *
 * 2.9.5: mounted at ROOT level (over whichever screen is up) because it is
 * raised by the privacy page's delete bridge, and the legal overlay can be
 * opened from any screen — not just how-it-works. The intermediate "Privacy
 * choices" card (2.9) is gone: its delete listing now lives INSIDE the
 * privacy page itself; this confirmation and the erasure flow it guards are
 * unchanged.
 */
export function renderOptOutDialog(c: V2ExperienceController): HTMLElement {
  const layer = el('div', 'wv2-modal-layer');
  const inFlight = c.optOutPhase === 'inFlight';

  const dim = el('div', 'wv2-modal-dim');
  dim.addEventListener('click', () => {
    if (!inFlight) c.cancelOptOut();
  });
  layer.appendChild(dim);

  const card = el('div', 'wv2-optout-card');
  if (c.optOutPhase === 'done') {
    card.appendChild(el('div', 'wv2-optout-success', AvafliV2Strings.optOutSuccess));
  } else {
    card.appendChild(el('div', 'wv2-optout-title', AvafliV2Strings.optOutTitle));
    card.appendChild(el('div', 'wv2-optout-body', AvafliV2Strings.optOutBody));
    if (c.optOutPhase === 'failed' && c.optOutError) {
      card.appendChild(el('div', 'wv2-optout-error', c.optOutError));
    }
    const confirm = renderPill(AvafliV2Strings.optOutConfirm, () => void c.confirmOptOut(), {
      loading: inFlight,
    });
    confirm.classList.add('wv2-pill-destructive');
    card.appendChild(confirm);
    const cancel = el('button', 'wv2-optout-cancel', AvafliV2Strings.optOutCancel);
    cancel.disabled = inFlight;
    cancel.addEventListener('click', () => c.cancelOptOut());
    card.appendChild(cancel);
  }
  layer.appendChild(card);
  return layer;
}

// ═══ Winner prize-claim flow (splash → 4 steps + review → confirmation) ═══
// Ported from iOS WINRV2Claim.swift + WINRV2ClaimSteps/ (Joe's stepped
// Figma design).

/** Claim-flow header: publisher logo centered, X close only (no "?"). */
function renderClaimHeader(logoUrl: string | null | undefined, onClose: () => void): HTMLElement {
  const header = el('div', 'wv2-claim-header');

  const logo = el('div', 'wv2-header-logo');
  if (logoUrl) {
    // Claim-flow screens replace each other inside the modal, so one shared
    // 'claim' node serves the splash, steps, share and confirmation headers.
    logo.appendChild(logoNode(logoUrl, 'claim'));
  } else {
    logo.appendChild(el('span', 'wv2-header-logo-fallback', 'Avafli'));
  }
  header.appendChild(logo);

  const close = el('button', 'wv2-circle-btn wv2-claim-close');
  const x = icon(closeIcon, 'wv2-ic');
  x.style.cssText = 'width:12px;height:12px';
  close.appendChild(x);
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', onClose);
  header.appendChild(close);

  return header;
}

/** Dark info card with a leading icon (shield/mail) — splash + confirmation. */
function renderClaimInfoCard(iconEl: HTMLElement, content: HTMLElement): HTMLElement {
  const card = el('div', 'wv2-claim-info-card');
  card.appendChild(iconEl);
  card.appendChild(content);
  return card;
}

// ─── Winner splash ("CONGRATULATIONS!") ───

export function renderWinnerSplash(
  c: V2ExperienceController,
  claim: PrizeClaimBlock,
  logoUrl?: string | null
): HTMLElement {
  const screen = el('div', 'wv2-screen wv2-claim-screen');
  const scroll = el('div', 'wv2-scroll');
  const stack = el('div', 'wv2-claim-stack');

  stack.appendChild(renderClaimHeader(logoUrl, () => c.requestDismiss()));

  // Trophy over the gold-sparkle art.
  const art = el('div', 'wv2-claim-trophy-art');
  const bg = el('img', 'wv2-claim-trophy-bg');
  bg.src = V2_IMAGES.winnerModalBg;
  bg.alt = '';
  art.appendChild(bg);
  const trophy = el('img', 'wv2-claim-trophy');
  trophy.src = V2_IMAGES.trophy;
  trophy.alt = '';
  art.appendChild(trophy);
  stack.appendChild(art);

  stack.appendChild(el('div', 'wv2-claim-congrats', 'CONGRATULATIONS!'));
  stack.appendChild(el('div', 'wv2-claim-latest', 'YOU’RE OUR LATEST WINNER!'));
  stack.appendChild(el('div', 'wv2-claim-youve-won', 'You’ve won:'));

  // Full-width white strip with the prize-derived headline (same derivation
  // as the Day-1 capture strip).
  stack.appendChild(
    el(
      'div',
      'wv2-claim-strip',
      stripHeadline(claim.prizeDescription, Math.round(claim.prizeValue))
    )
  );

  stack.appendChild(
    el('div', 'wv2-claim-body-copy', 'To process your prize, we just need a few details.')
  );

  const shield = icon(shieldIcon, 'wv2-claim-shield');
  stack.appendChild(
    renderClaimInfoCard(
      shield,
      el(
        'div',
        'wv2-claim-info-text',
        'Your information is securely collected and only used to verify your prize and announce you as our winner.'
      )
    )
  );

  const cta = el('div', 'wv2-claim-cta');
  cta.appendChild(renderPill('CONTINUE', () => c.winnerClaimContinue()));
  stack.appendChild(cta);

  scroll.appendChild(stack);
  screen.appendChild(scroll);

  // 2.9.4 (Joe's updated frame): celebration layer on splash appearance —
  // the looping multicolor confetti field over the whole splash plus the
  // one-shot Figma confetti-burst GIF over the trophy art. Purely
  // decorative: the canvas/GIF never take pointer events, so nothing blocks
  // CONTINUE or the X. Under prefers-reduced-motion the field freezes to a
  // single static frame (createConfetti handles that) and the GIF — which
  // has no static mode — is simply not mounted.
  const confetti = createConfetti({ style: 'celebration', count: 18, speed: 0.55 });
  screen.appendChild(confetti);
  if (!prefersReducedMotion()) {
    mountGifBurst({
      parent: art,
      src: V2_IMAGES.confettiBurst,
      className: 'wv2-splash-burst',
      durationMs: CONFETTI_BURST_DURATION_MS,
    });
  }

  return screen;
}

// ─── Stepped claim form (2.9: 3 steps + review; share moved POST-submit) ───
// Ported from iOS WINRV2ClaimSteps/: a persistent gold-sparkle backdrop +
// header + animated step indicator, with the form steps and the review
// screen sliding horizontally beneath them (push left on advance, push right
// on back). The "PLEASE SHARE A LITTLE" step no longer lives here — it shows
// AFTER the claim is submitted (see renderWinnerShare) so it can never block
// the claim.

/** The four screens of the stepped form (4 = review, no step indicator). */
type ClaimFlowStep = 1 | 2 | 3 | 4;

/** How many numbered steps the indicator shows (review is unnumbered). */
const CLAIM_STEP_COUNT = 3;

export function renderClaimSteps(
  c: V2ExperienceController,
  claim: PrizeClaimBlock,
  logoUrl?: string | null
): HTMLElement {
  // Form + photo preview live at flow level so every step keeps its values
  // when the user navigates back and forth.
  const form: PrizeClaimForm = c.claimFormPrefill;
  let photoPreviewUrl: string | null = null;
  let step: ClaimFlowStep = 1;
  let animating = false;

  const screen = el('div', 'wv2-screen wv2-claim-screen');

  // Gold-sparkle full-bleed backdrop fading into the dark body (406px, per
  // the frames).
  const backdrop = el('div', 'wv2-claim-form-bg');
  const backdropImg = el('img');
  backdropImg.src = V2_IMAGES.winnerModalBg;
  backdropImg.alt = '';
  backdrop.appendChild(backdropImg);
  backdrop.appendChild(el('div', 'wv2-claim-form-bg-grad'));
  screen.appendChild(backdrop);

  const flow = el('div', 'wv2-claim-flow');

  // Persistent header: back chevron (steps 2+ / review), logo, X close.
  const header = el('div', 'wv2-claim-header');
  const back = el('button', 'wv2-circle-btn wv2-claim-back');
  const chev = icon(chevronLeftIcon, 'wv2-ic');
  chev.style.cssText = 'width:10px;height:16px';
  back.appendChild(chev);
  back.setAttribute('aria-label', 'Back');
  back.addEventListener('click', () => {
    if (step > 1) go((step - 1) as ClaimFlowStep);
  });
  header.appendChild(back);
  const logo = el('div', 'wv2-header-logo');
  if (logoUrl) {
    // Claim-flow screens replace each other inside the modal, so one shared
    // 'claim' node serves the splash, steps, share and confirmation headers.
    logo.appendChild(logoNode(logoUrl, 'claim'));
  } else {
    logo.appendChild(el('span', 'wv2-header-logo-fallback', 'Avafli'));
  }
  header.appendChild(logo);
  const close = el('button', 'wv2-circle-btn wv2-claim-close');
  const x = icon(closeIcon, 'wv2-ic');
  x.style.cssText = 'width:12px;height:12px';
  close.appendChild(x);
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => c.requestDismiss());
  header.appendChild(close);
  flow.appendChild(header);

  // "STEP N OF 3" + the row of 3 dots connected by accent lines. The fill
  // animates via CSS transitions; hidden on the review screen.
  const indicator = el('div', 'wv2-step-indicator');
  const stepLabel = el('div', 'wv2-step-label');
  indicator.appendChild(stepLabel);
  const dotsRow = el('div', 'wv2-step-dots');
  const dots: HTMLElement[] = [];
  for (let i = 1; i <= CLAIM_STEP_COUNT; i++) {
    const dot = el('div', 'wv2-step-dot');
    dots.push(dot);
    dotsRow.appendChild(dot);
    if (i < CLAIM_STEP_COUNT) dotsRow.appendChild(el('div', 'wv2-step-line'));
  }
  indicator.appendChild(dotsRow);
  flow.appendChild(indicator);

  // Pages viewport: steps slide horizontally beneath the fixed chrome.
  const pages = el('div', 'wv2-claim-pages');
  flow.appendChild(pages);
  screen.appendChild(flow);

  const syncChrome = (): void => {
    back.style.visibility = step === 1 ? 'hidden' : 'visible';
    if (step === 4) {
      indicator.classList.add('wv2-step-indicator-hidden');
    } else {
      indicator.classList.remove('wv2-step-indicator-hidden');
      stepLabel.textContent = `STEP ${step} OF ${CLAIM_STEP_COUNT}`;
      indicator.setAttribute('aria-label', `Step ${step} of ${CLAIM_STEP_COUNT}`);
      dots.forEach((dot, i) => dot.classList.toggle('wv2-filled', i + 1 <= step));
    }
  };

  /** Steps push left when advancing and right when going back (300ms). */
  const go = (next: ClaimFlowStep): void => {
    if (animating || next === step) return;
    const advancing = next > step;
    const oldPage = pages.firstElementChild as HTMLElement | null;
    step = next;
    syncChrome();
    const newPage = renderPage(step);
    newPage.classList.add(advancing ? 'wv2-page-in-right' : 'wv2-page-in-left');
    pages.appendChild(newPage);
    if (oldPage) {
      animating = true;
      oldPage.classList.add(advancing ? 'wv2-page-out-left' : 'wv2-page-out-right');
    }
    setTimeout(() => {
      oldPage?.remove();
      // Drop the slide-in class once the animation window passes so a
      // throttled/paused animation (hidden tab) can never leave the page
      // stuck off-screen at the first keyframe.
      newPage.classList.remove('wv2-page-in-right', 'wv2-page-in-left');
      animating = false;
    }, 320);
  };

  // ── Page scaffold: title / subtitle / content / CTA pill / footer ──

  interface PageOptions {
    title: string;
    subtitle?: string;
    ctaTitle?: string;
    ctaEnabled?: () => boolean;
    onCTA: (cta: HTMLButtonElement) => void;
    /**
     * Called when the user taps the CTA while it is dimmed/disabled — the
     * page's chance to SAY WHY (inline field errors) instead of a dead
     * button. The disabled pill lets the click through to the wrapper via
     * CSS (pointer-events: none on :disabled).
     */
    onBlockedCTA?: () => void;
    footer?: HTMLElement;
  }

  const buildPage = (
    options: PageOptions,
    content: HTMLElement
  ): { page: HTMLElement; cta: HTMLButtonElement; refresh: () => void } => {
    const pageEl = el('div', 'wv2-claim-page');
    const stack = el('div', 'wv2-step-stack');

    const title = el('div', 'wv2-step-title');
    // Support the frame's forced line break in step 2's title.
    options.title.split('\n').forEach((line, i) => {
      if (i > 0) title.appendChild(el('br'));
      title.appendChild(document.createTextNode(line));
    });
    stack.appendChild(title);
    if (options.subtitle) {
      const sub = el('div', 'wv2-step-subtitle');
      options.subtitle.split('\n').forEach((line, i) => {
        if (i > 0) sub.appendChild(el('br'));
        sub.appendChild(document.createTextNode(line));
      });
      stack.appendChild(sub);
    }

    stack.appendChild(content);

    const enabled = options.ctaEnabled ?? ((): boolean => true);
    const ctaWrap = el('div', 'wv2-step-cta');
    const cta = renderPill(options.ctaTitle ?? 'CONTINUE', () => options.onCTA(cta), {
      disabled: !enabled(),
    });
    if (options.onBlockedCTA) {
      ctaWrap.addEventListener('click', () => {
        if (cta.disabled) options.onBlockedCTA!();
      });
    }
    ctaWrap.appendChild(cta);
    stack.appendChild(ctaWrap);

    if (options.footer) stack.appendChild(options.footer);

    pageEl.appendChild(stack);
    const refresh = (): void => {
      cta.disabled = !enabled();
      cta.classList.toggle('wv2-pill-dim', !enabled());
    };
    return { page: pageEl, cta, refresh };
  };

  // ── Field builders (claim-step frame styling) ──

  type TextKey = 'firstName' | 'lastName' | 'phone' | 'street' | 'apt' | 'city' | 'zip';

  const stepField = (options: {
    label: string;
    key: TextKey;
    refresh: () => void;
    type?: string;
    autocomplete?: string;
    inputmode?: string;
    zipMode?: boolean;
  }): HTMLElement => {
    const wrap = el('div', 'wv2-sf');
    wrap.appendChild(el('label', 'wv2-sf-label', options.label));
    const input = el('input', 'wv2-sf-input');
    input.type = options.type ?? 'text';
    if (options.autocomplete) input.setAttribute('autocomplete', options.autocomplete);
    if (options.inputmode) input.setAttribute('inputmode', options.inputmode);
    input.setAttribute('autocorrect', 'off');
    input.value = form[options.key];
    if (options.zipMode) input.maxLength = 5;
    input.addEventListener('input', () => {
      if (options.zipMode) {
        const digits = input.value.replace(/\D/g, '').slice(0, 5);
        if (digits !== input.value) input.value = digits;
      }
      form[options.key] = input.value;
      options.refresh();
    });
    wrap.appendChild(input);
    return wrap;
  };

  /** A locked (non-editable) field — winning email and Country rows. */
  const lockedField = (options: {
    label: string;
    value: string;
    dimmed?: boolean;
    showsChevron?: boolean;
  }): HTMLElement => {
    const wrap = el('div', 'wv2-sf');
    wrap.appendChild(el('label', 'wv2-sf-label', options.label));
    const box = el('div', 'wv2-sf-locked');
    const value = el('span', 'wv2-sf-locked-value', options.value);
    if (options.dimmed !== false) value.classList.add('wv2-sf-dim');
    box.appendChild(value);
    if (options.showsChevron) box.appendChild(icon(arrowDownIcon, 'wv2-sf-chevron'));
    wrap.appendChild(box);
    return wrap;
  };

  // ── Step 1: TELL US ABOUT YOURSELF ──

  const renderStep1 = (): HTMLElement => {
    const fields = el('div', 'wv2-step-fields');

    // Per-field inline errors (Master Field List): armed by a CONTINUE
    // attempt on the dimmed CTA, then live — each message clears the moment
    // its field becomes valid. The dimming alone explained nothing.
    let showErrors = false;
    const firstErr = renderFieldError();
    const lastErr = renderFieldError();
    const phoneErr = renderFieldError();
    const syncErrors = (): void => {
      if (!showErrors) return;
      setFieldError(
        firstErr,
        isValidClaimName(form.firstName) ? null : AvafliV2Strings.firstNameInvalid
      );
      setFieldError(lastErr, isValidClaimName(form.lastName) ? null : AvafliV2Strings.lastNameInvalid);
      setFieldError(phoneErr, isValidClaimPhone(form.phone) ? null : AvafliV2Strings.phoneInvalid);
    };

    const { page, refresh } = buildPage(
      {
        title: 'TELL US ABOUT YOURSELF',
        subtitle:
          "We'll use this information to verify your prize and personalize your winner announcement.",
        ctaEnabled: () => isStep1Valid(form),
        onCTA: () => go(2),
        onBlockedCTA: () => {
          showErrors = true;
          syncErrors();
        },
      },
      fields
    );
    const refreshAll = (): void => {
      refresh();
      syncErrors();
    };

    const first = stepField({
      label: 'First Name',
      key: 'firstName',
      refresh: refreshAll,
      autocomplete: 'given-name',
    });
    first.appendChild(firstErr);
    fields.appendChild(first);

    const last = stepField({
      label: 'Last Name (we will only show your last initial)',
      key: 'lastName',
      refresh: refreshAll,
      autocomplete: 'family-name',
    });
    last.appendChild(lastErr);
    fields.appendChild(last);

    // The winning email lives server-side (the SDK never stores the raw
    // address) and the claim is keyed to the account — shown locked, masked
    // by the backend for recognition.
    fields.appendChild(
      lockedField({
        label: 'Winning Email Address (cannot be changed)',
        value: claim.maskedEmail || 'On file with your winning entry',
      })
    );

    const phone = stepField({
      label: 'Phone Number (optional)',
      key: 'phone',
      refresh: refreshAll,
      type: 'tel',
      autocomplete: 'tel',
      inputmode: 'tel',
    });
    phone.appendChild(phoneErr);
    fields.appendChild(phone);
    return page;
  };

  // ── Step 2: WHERE SHOULD WE SEND YOUR PRIZE? ──

  const renderStep2 = (): HTMLElement => {
    const fields = el('div', 'wv2-step-fields wv2-step-fields-address');
    const { page, refresh } = buildPage(
      {
        title: 'WHERE SHOULD WE\nSEND YOUR PRIZE?',
        ctaEnabled: () => isStep2Valid(form),
        onCTA: () => go(3),
      },
      fields
    );
    const streetField = stepField({
      label: 'Street Address',
      key: 'street',
      refresh,
      autocomplete: 'address-line1',
    });
    fields.appendChild(streetField);
    fields.appendChild(
      stepField({
        label: 'Apartment, Suite, etc. (optional)',
        key: 'apt',
        refresh,
        autocomplete: 'address-line2',
      })
    );
    const cityField = stepField({
      label: 'City',
      key: 'city',
      refresh,
      autocomplete: 'address-level2',
    });
    fields.appendChild(cityField);

    // State picker + zip, side by side.
    const row = el('div', 'wv2-sf-row');
    const stateWrap = el('div', 'wv2-sf wv2-sf-state');
    stateWrap.appendChild(el('label', 'wv2-sf-label', 'State'));
    const selectWrap = el('div', 'wv2-sf-select-wrap');
    const select = el('select', 'wv2-sf-select');
    const placeholder = el('option', undefined, 'Select');
    placeholder.value = '';
    placeholder.disabled = true;
    select.appendChild(placeholder);
    for (const state of US_STATES) {
      const option = el('option', undefined, state);
      option.value = state;
      select.appendChild(option);
    }
    select.value = form.state;
    select.classList.toggle('wv2-placeholder', form.state === '');
    select.addEventListener('change', () => {
      form.state = select.value;
      select.classList.toggle('wv2-placeholder', select.value === '');
      refresh();
    });
    selectWrap.appendChild(select);
    selectWrap.appendChild(icon(arrowDownIcon, 'wv2-sf-chevron'));
    stateWrap.appendChild(selectWrap);
    row.appendChild(stateWrap);
    const zip = stepField({ label: 'Zip Code', key: 'zip', refresh, inputmode: 'numeric', zipMode: true });
    zip.classList.add('wv2-sf-zip');
    row.appendChild(zip);
    fields.appendChild(row);

    // US-only sweepstakes — the country row renders like the frame's dropdown
    // but is fixed.
    fields.appendChild(
      lockedField({ label: 'Country', value: CLAIM_COUNTRY, dimmed: false, showsChevron: true })
    );

    // Google Places autocomplete on the street field — ONLY when the server
    // configured a key (sdkConfig.placesApiKey). A selection fills all four
    // address fields; every field stays fully hand-editable afterward, and
    // without a key (or on any Places failure) this step behaves exactly as
    // the plain fields above.
    attachPlacesAutocomplete({
      apiKey: c.sdkConfig?.placesApiKey,
      input: streetField.querySelector('input') as HTMLInputElement,
      onAddress: (address) => {
        const streetInput = streetField.querySelector('input') as HTMLInputElement;
        const cityInput = cityField.querySelector('input') as HTMLInputElement;
        const zipInput = zip.querySelector('input') as HTMLInputElement;
        if (address.street) {
          form.street = address.street;
          streetInput.value = address.street;
        }
        if (address.city) {
          form.city = address.city;
          cityInput.value = address.city;
        }
        const stateName = stateNameFromShortCode(address.state);
        if (stateName) {
          form.state = stateName;
          select.value = stateName;
          select.classList.remove('wv2-placeholder');
        }
        // Zip is set even when Google omits it — a stale zip from a previous
        // address would silently ship the prize to the wrong place.
        form.zip = address.zip.replace(/\D/g, '').slice(0, 5);
        zipInput.value = form.zip;
        refresh();
      },
    });
    return page;
  };

  // ── Step 3: SHOW OFF YOUR WIN! ──

  // Hidden file inputs at flow level so a picked photo survives navigation.
  // UPLOAD opens the file picker; TAKE requests the camera on devices that
  // have one (`capture` is ignored on desktop → plain picker fallback).
  const libraryInput = el('input');
  libraryInput.type = 'file';
  libraryInput.accept = 'image/png,image/jpeg,image/webp';
  libraryInput.style.display = 'none';
  const cameraInput = el('input');
  cameraInput.type = 'file';
  cameraInput.accept = 'image/*';
  cameraInput.setAttribute('capture', 'environment');
  cameraInput.style.display = 'none';
  screen.appendChild(libraryInput);
  screen.appendChild(cameraInput);

  const renderStep3 = (): HTMLElement => {
    const content = el('div', 'wv2-step3');

    // 242px circular preview with the accent ring and the camera badge
    // breaking the bottom-right edge (tappable — same as TAKE PHOTO).
    const avatar = el('div', 'wv2-claim-avatar');
    const avatarImg = el('img', 'wv2-claim-avatar-img');
    avatarImg.alt = '';
    const person = icon(personIcon, 'wv2-claim-avatar-person');
    const syncAvatar = (): void => {
      if (photoPreviewUrl) {
        avatarImg.src = photoPreviewUrl;
        avatarImg.style.display = '';
        person.style.display = 'none';
      } else {
        avatarImg.style.display = 'none';
        person.style.display = '';
      }
    };
    avatar.appendChild(avatarImg);
    avatar.appendChild(person);
    const badge = el('button', 'wv2-claim-avatar-badge');
    badge.type = 'button';
    badge.appendChild(icon(cameraIcon, 'wv2-claim-badge-camera'));
    badge.setAttribute('aria-label', 'Take photo');
    badge.addEventListener('click', () => cameraInput.click());
    avatar.appendChild(badge);
    content.appendChild(avatar);
    syncAvatar();

    const attach = (file: File | undefined): void => {
      if (!file) return;
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      photoPreviewUrl = URL.createObjectURL(file);
      syncAvatar();
      // Encode the upload payload in the background (same downscale/base64
      // pipeline as before); the preview shows immediately.
      delete form.photoBase64;
      void claimPhotoBase64Jpeg(file).then((encoded) => {
        if (encoded) form.photoBase64 = encoded;
      });
    };
    libraryInput.onchange = (): void => attach(libraryInput.files?.[0]);
    cameraInput.onchange = (): void => attach(cameraInput.files?.[0]);

    const buttons = el('div', 'wv2-photo-btns');
    const photoButton = (iconSvg: string, title: string, onClick: () => void): HTMLElement => {
      const btn = el('button', 'wv2-photo-btn');
      btn.type = 'button';
      btn.appendChild(icon(iconSvg, 'wv2-photo-btn-ic'));
      btn.appendChild(el('span', undefined, title));
      btn.addEventListener('click', onClick);
      return btn;
    };
    buttons.appendChild(photoButton(uploadIcon, 'UPLOAD PHOTO', () => libraryInput.click()));
    buttons.appendChild(photoButton(cameraIcon, 'TAKE PHOTO', () => cameraInput.click()));
    content.appendChild(buttons);

    const note = el('div', 'wv2-photo-note');
    note.appendChild(
      document.createTextNode('Your photo may appear in our Winner Gallery,')
    );
    note.appendChild(el('br'));
    note.appendChild(document.createTextNode('social media, and promotional materials.'));
    content.appendChild(note);

    const { page } = buildPage(
      {
        title: 'SHOW OFF YOUR WIN!',
        subtitle: "Upload a photo we'd be proud to\nfeature as one of our winners.",
        onCTA: () => go(4),
      },
      content
    );
    return page;
  };

  // ── Review: ALMOST DONE! ──
  // 2.9 (team decision 14 Aug): checkboxes 1 ("information is accurate") and
  // 3 ("agree to Official Rules") are REMOVED. Only the likeness/promotion
  // checkbox remains, and it is OPTIONAL: SUBMIT never waits on it; its
  // state travels as `promoConsentGranted` on the claim payload.
  // 2.9.4 (Joe's updated frames): the leftover "Official Rules • Privacy
  // Policy" links row is gone from review too (entering already bound the
  // user — the capture screen's inline disclaimer links carry the legal
  // surface). The screen is now just the likeness consent + SUBMIT + the
  // secure-note. The likeness copy names the actual publisher when known
  // (sdkConfig.appName, else the host page's title — the share line's same
  // source) instead of "this app's publisher".

  const renderReview = (): HTMLElement => {
    const content = el('div', 'wv2-review');

    const consents = el('div', 'wv2-consents');
    const likenessRow = el('button', 'wv2-consent-row');
    likenessRow.type = 'button';
    const box = el('span', 'wv2-consent-box');
    box.innerHTML = checkIconSvg;
    likenessRow.appendChild(box);
    likenessRow.appendChild(
      el('span', 'wv2-consent-text', likenessConsentText(c.publisherName))
    );
    const syncLikeness = (): void => {
      box.classList.toggle('wv2-consent-on', form.authorizesLikeness);
      likenessRow.setAttribute('aria-pressed', String(form.authorizesLikeness));
    };
    likenessRow.addEventListener('click', () => {
      form.authorizesLikeness = !form.authorizesLikeness;
      syncLikeness();
    });
    syncLikeness();
    consents.appendChild(likenessRow);
    content.appendChild(consents);

    const errorEl = el('div', 'wv2-claim-error');
    errorEl.style.display = 'none';
    content.appendChild(errorEl);

    // Gunmetal "secure and encrypted" lock note under the CTA.
    const lockNote = el('div', 'wv2-review-lock');
    lockNote.appendChild(icon(lockIcon, 'wv2-review-lock-ic'));
    lockNote.appendChild(
      el('span', undefined, 'Your information is secure and encrypted.')
    );

    const onSubmit = async (cta: HTMLButtonElement): Promise<void> => {
      if (!isClaimFormValid(form) || c.isSubmittingClaim) return;
      errorEl.style.display = 'none';
      cta.textContent = '';
      cta.appendChild(el('span', 'wv2-spinner'));
      cta.disabled = true;

      await c.submitPrizeClaim(form);

      // Success and the "not the winner" fall-back both re-render the whole
      // state; only a transport failure leaves us here — surface it inline.
      if (c.state.kind === 'winnerClaim' && c.winnerClaimStep.kind === 'form') {
        cta.textContent = 'SUBMIT PRIZE CLAIM';
        cta.disabled = !isClaimFormValid(form);
        cta.classList.toggle('wv2-pill-dim', cta.disabled);
        if (c.claimSubmitError) {
          errorEl.textContent = c.claimSubmitError;
          errorEl.style.display = '';
        }
      }
    };

    const { page } = buildPage(
      {
        // SUBMIT is always enabled here (the required steps gated their own
        // CONTINUEs) — the optional likeness checkbox never dims it.
        title: 'ALMOST DONE!',
        subtitle: 'Please review and submit to claim your prize.',
        ctaTitle: 'SUBMIT PRIZE CLAIM',
        ctaEnabled: () => isClaimFormValid(form),
        onCTA: (cta) => void onSubmit(cta),
        footer: lockNote,
      },
      content
    );
    return page;
  };

  const renderPage = (s: ClaimFlowStep): HTMLElement => {
    switch (s) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderReview();
    }
  };

  syncChrome();
  pages.appendChild(renderPage(step));
  return screen;
}

/** Bare checkmark stroke for the review consent boxes. */
const checkIconSvg =
  '<svg viewBox="0 0 14 11" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;width:13px;height:10px">' +
  '<path d="M1.5 5.5L5.2 9.2L12.5 1.5" stroke="var(--wv2-on-accent, #fff)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ─── Share step ("PLEASE SHARE A LITTLE") — POST-submit, never blocking ───

/**
 * Appends `utm_source={network}&utm_medium=avafli_share` to the publisher's
 * shareUrl via the URL API (correct whether or not the URL already has a
 * query string). A URL already carrying a `utm_source` param is returned
 * untouched — the publisher's own tagging wins. Unparseable URLs pass
 * through unchanged. Exported for tests.
 */
export function taggedShareUrl(
  shareUrl: string | null | undefined,
  network: string
): string | null | undefined {
  if (!shareUrl) return shareUrl;
  let url: URL;
  try {
    url = new URL(shareUrl);
  } catch {
    return shareUrl;
  }
  if (url.searchParams.has('utm_source')) return shareUrl;
  url.searchParams.append('utm_source', network);
  url.searchParams.append('utm_medium', 'avafli_share');
  return url.toString();
}

/**
 * 2.9: the share step shows AFTER the claim is submitted. The claim is
 * already recorded server-side, so nothing here can gate or undo it —
 * CONTINUE advances to the confirmation screen and the X simply closes the
 * drawer; both leave the claim untouched.
 *
 * The social buttons perform REAL, honest actions (team decision 14 Aug):
 *  - X: tweet intent, prefilled "I just won {prize} in {appName}!" plus the
 *    publisher's shareUrl when configured.
 *  - Facebook: the sharer with the shareUrl. FB does not allow prefilled
 *    text — that is a platform rule, so none is faked.
 *  - Instagram / Snapchat / TikTok: NO web prefill APIs exist. Use the Web
 *    Share API (text + url) when available; otherwise copy the line to the
 *    clipboard with a "Copied! Paste it in your post" toast.
 * Same icons as before — nothing removed visually.
 */
export function renderWinnerShare(
  c: V2ExperienceController,
  claim: PrizeClaimBlock,
  logoUrl?: string | null
): HTMLElement {
  const screen = el('div', 'wv2-screen wv2-claim-screen');

  // Same gold-sparkle backdrop as the stepped form.
  const backdrop = el('div', 'wv2-claim-form-bg');
  const backdropImg = el('img');
  backdropImg.src = V2_IMAGES.winnerModalBg;
  backdropImg.alt = '';
  backdrop.appendChild(backdropImg);
  backdrop.appendChild(el('div', 'wv2-claim-form-bg-grad'));
  screen.appendChild(backdrop);

  const flow = el('div', 'wv2-claim-flow');
  flow.appendChild(renderClaimHeader(logoUrl, () => c.requestDismiss()));

  const scroll = el('div', 'wv2-scroll');
  scroll.style.position = 'relative';
  const stack = el('div', 'wv2-step-stack');
  stack.appendChild(el('div', 'wv2-step-title', 'PLEASE SHARE A LITTLE'));
  stack.appendChild(
    el('div', 'wv2-step-subtitle', 'This helps us show real people like you win!')
  );

  const content = el('div', 'wv2-step4');

  // The story draft lives on the CONTROLLER so every exit path (DONE, X,
  // backdrop, Escape) can attach it via attachClaimStory — never lost.
  const storyWrap = el('div', 'wv2-story');
  const story = el('textarea', 'wv2-story-input');
  story.placeholder =
    'Please share anything. What you’re going to do with the prize, why you love our app, your favorite food, etc.';
  story.value = c.claimStoryDraft;
  story.addEventListener('input', () => {
    c.claimStoryDraft = story.value;
  });
  storyWrap.appendChild(story);
  content.appendChild(storyWrap);

  /** "I just won {prize} in {appName}!" — appName is the host page's title. */
  const shareLine = (): string => {
    const prize = stripHeadline(claim.prizeDescription, Math.round(claim.prizeValue));
    const appName = document.title.trim();
    return appName ? `I just won ${prize} in ${appName}!` : `I just won ${prize}!`;
  };

  const shareUrl = c.shareUrl;
  /** The publisher shareUrl UTM-tagged with the tapped network. */
  const taggedUrl = (network: string): string | null | undefined =>
    taggedShareUrl(shareUrl, network);

  // Transient "Copied!" toast for the clipboard fallback.
  let toastTimer: number | null = null;
  const toast = el('div', 'wv2-share-toast', AvafliV2Strings.shareCopied);
  screen.appendChild(toast);
  const showToast = (): void => {
    toast.classList.add('wv2-visible');
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('wv2-visible');
      toastTimer = null;
    }, 2200);
  };

  /**
   * IG/Snap/TikTok: Web Share API when available, else clipboard + toast.
   * The shareUrl is UTM-tagged with the tapped [network] on both paths.
   */
  const systemShare = (network: string): void => {
    const text = shareLine();
    const url = taggedUrl(network);
    const nav = navigator as Navigator & {
      share?: (data: { text: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      nav.share({ text, ...(url ? { url } : {}) }).catch(() => undefined);
    } else if (navigator.clipboard) {
      const line = url ? `${text} ${url}` : text;
      navigator.clipboard
        .writeText(line)
        .then(showToast)
        .catch(() => undefined);
    }
  };

  const shareToX = (): void => {
    const params = new URLSearchParams({ text: shareLine() });
    const url = taggedUrl('x');
    if (url) params.set('url', url);
    openUrl(`https://twitter.com/intent/tweet?${params.toString()}`);
  };

  const shareToFacebook = (): void => {
    // FB's sharer takes ONLY a URL (prefilled text is not allowed by the
    // platform). Fall back to the host page when no shareUrl is configured
    // (the host page is not the publisher's shareUrl, so it is not tagged).
    const u = taggedUrl('facebook') || window.location.href;
    openUrl(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`);
  };

  const social = el('div', 'wv2-social');
  social.appendChild(el('div', 'wv2-social-title', 'Share on Social Media:'));
  const socialRow = el('div', 'wv2-social-row');
  const glyphs: Array<[string, string, () => void]> = [
    [socialInstagramIcon, 'Instagram', () => systemShare('instagram')],
    [socialFacebookIcon, 'Facebook', shareToFacebook],
    [socialXIcon, 'X', shareToX],
    [socialSnapchatIcon, 'Snapchat', () => systemShare('snapchat')],
    [socialTiktokIcon, 'TikTok', () => systemShare('tiktok')],
  ];
  for (const [glyph, name, action] of glyphs) {
    const btn = el('button', 'wv2-social-btn');
    btn.type = 'button';
    btn.appendChild(icon(glyph, 'wv2-social-glyph'));
    btn.setAttribute('aria-label', `Share on ${name}`);
    btn.addEventListener('click', action);
    socialRow.appendChild(btn);
  }
  social.appendChild(socialRow);
  content.appendChild(social);

  stack.appendChild(content);

  const ctaWrap = el('div', 'wv2-step-cta');
  ctaWrap.appendChild(renderPill('CONTINUE', () => c.winnerShareContinue()));
  stack.appendChild(ctaWrap);

  scroll.appendChild(stack);
  flow.appendChild(scroll);
  screen.appendChild(flow);
  return screen;
}

// ─── Confirmation ("YOUR PRIZE CLAIM HAS BEEN SUBMITTED") ───

export function renderClaimConfirmation(
  c: V2ExperienceController,
  claimNumber: string,
  submittedAt: string,
  logoUrl?: string | null
): HTMLElement {
  const form = c.submittedClaimForm;

  const screen = el('div', 'wv2-screen wv2-claim-screen');

  // Gold-sparkle backdrop behind the header/title, fading into the dark body
  // (Joe's confirmation frame — same treatment as the stepped form).
  const backdrop = el('div', 'wv2-claim-form-bg wv2-claim-done-bg');
  const backdropImg = el('img');
  backdropImg.src = V2_IMAGES.winnerModalBg;
  backdropImg.alt = '';
  backdrop.appendChild(backdropImg);
  backdrop.appendChild(el('div', 'wv2-claim-form-bg-grad'));
  screen.appendChild(backdrop);

  const scroll = el('div', 'wv2-scroll');
  scroll.style.position = 'relative'; // content stacks above the backdrop
  const stack = el('div', 'wv2-claim-stack');

  stack.appendChild(renderClaimHeader(logoUrl, () => c.requestDismiss()));

  stack.appendChild(
    el('div', 'wv2-claim-done-title', 'YOUR PRIZE CLAIM HAS BEEN SUBMITTED')
  );
  stack.appendChild(
    el(
      'div',
      'wv2-claim-done-sub',
      'Our team is reviewing your information. You’ll receive a confirmation email shortly.'
    )
  );

  // Mail icon in an accent-ringed circle on the "3-5 Business Days" card.
  // 2.9.4 (Joe's frame 5386:5807): solid dark gunmetal card with a subtle
  // border (modifier class) — ring stroke and the days line stay in the
  // publisher accent, never a hardcoded color.
  const mailRing = el('div', 'wv2-claim-mail-ring');
  mailRing.appendChild(icon(mailIcon, 'wv2-claim-mail'));
  const mailCol = el('div', 'wv2-claim-mail-col');
  mailCol.appendChild(el('div', 'wv2-claim-mail-line', 'Expect to receive your prize within'));
  mailCol.appendChild(el('div', 'wv2-claim-mail-days', '3-5 Business Days'));
  const daysCard = renderClaimInfoCard(mailRing, mailCol);
  daysCard.classList.add('wv2-claim-done-card');
  stack.appendChild(daysCard);

  // The gold OFFICIAL WINNER keepsake card: cream/gold gradient, small trophy
  // breaking the top border, serif name, award month + claim number.
  const card = el('div', 'wv2-gold-card');
  const trophy = el('img', 'wv2-gold-trophy');
  trophy.src = V2_IMAGES.trophy;
  trophy.alt = '';
  card.appendChild(trophy);

  const officialRow = el('div', 'wv2-gold-official');
  officialRow.appendChild(el('span', undefined, 'OFFICIAL'));
  officialRow.appendChild(el('span', undefined, 'WINNER'));
  card.appendChild(officialRow);

  card.appendChild(el('div', 'wv2-gold-name', form ? claimDisplayName(form) : 'Our Winner'));
  if (form && form.city.trim() !== '') {
    card.appendChild(
      el('div', 'wv2-gold-loc', `${form.city.trim()}, ${form.state.trim()}`)
    );
  }
  card.appendChild(
    el('div', 'wv2-gold-meta', `${monthYearDisplay(submittedAt)} • ${claimNumber}`)
  );
  stack.appendChild(card);

  const cta = el('div', 'wv2-claim-cta wv2-claim-done-cta');
  cta.appendChild(renderPill('RETURN TO APP', () => c.requestDismiss()));
  stack.appendChild(cta);

  scroll.appendChild(stack);
  screen.appendChild(scroll);

  // 2.9.4 (Joe's frame): confirmation celebrates on appearance with the same
  // machinery as the winner splash — the looping multicolor confetti field
  // over the screen plus the one-shot Figma burst GIF centered on the gold
  // keepsake card (its position:relative anchors the shared burst class).
  // Decorative and non-blocking; under prefers-reduced-motion the field
  // freezes to a static frame and the GIF is skipped. Works in both the
  // mobile drawer and the desktop lightbox.
  const confetti = createConfetti({ style: 'celebration', count: 18, speed: 0.55 });
  screen.appendChild(confetti);
  if (!prefersReducedMotion()) {
    mountGifBurst({
      parent: card,
      src: V2_IMAGES.confettiBurst,
      className: 'wv2-splash-burst',
      durationMs: CONFETTI_BURST_DURATION_MS,
    });
  }

  return screen;
}

// ─── "WE HAVE A WINNER!" banner + dialog ───

export function renderWinnerBanner(onTap: () => void): HTMLElement {
  const banner = el('button', 'wv2-winner-banner');
  const trophy = el('img', 'wv2-winner-banner-trophy');
  trophy.src = V2_IMAGES.trophy;
  trophy.alt = '';
  banner.appendChild(trophy);
  const col = el('div', 'wv2-winner-banner-col');
  col.appendChild(el('div', 'wv2-winner-banner-title', 'WE HAVE A WINNER!'));
  col.appendChild(el('div', 'wv2-winner-banner-sub', 'Tap to see latest winners.'));
  banner.appendChild(col);
  const plus = el('div', 'wv2-winner-banner-plus');
  plus.appendChild(icon(plusIcon, 'wv2-ic'));
  banner.appendChild(plus);
  banner.addEventListener('click', onTap);
  return banner;
}

export function renderWinnerModal(winner: GiveawayWinner, onDismiss: () => void): HTMLElement {
  const layer = el('div', 'wv2-modal-layer');
  const dim = el('div', 'wv2-modal-dim');
  dim.addEventListener('click', onDismiss);
  layer.appendChild(dim);

  const card = el('div', 'wv2-winner-card');

  // Gold-sparkle art behind the content.
  const bg = el('div', 'wv2-winner-bg');
  const bgImg = el('img');
  bgImg.src = V2_IMAGES.winnerModalBg;
  bgImg.alt = '';
  bg.appendChild(bgImg);
  bg.appendChild(el('div', 'wv2-winner-bg-grad'));
  bg.appendChild(createConfetti({ style: 'gold', count: 26, speed: 0.7 }));
  card.appendChild(bg);

  const content = el('div', 'wv2-winner-content');

  const top = el('div', 'wv2-winner-top');
  const trophyWrap = el('div', 'wv2-winner-trophy-wrap');
  const trophy = el('img', 'wv2-winner-trophy');
  trophy.src = V2_IMAGES.trophy;
  trophy.alt = '';
  trophyWrap.appendChild(trophy);
  top.appendChild(trophyWrap);
  const heading = el('div', 'wv2-winner-heading');
  heading.appendChild(el('div', 'wv2-winner-wehavea', 'WE HAVE A'));
  heading.appendChild(el('div', 'wv2-winner-winner', 'WINNER!'));
  heading.appendChild(
    el('div', 'wv2-winner-congrats', 'Congratulations to our latest big winner!')
  );
  top.appendChild(heading);
  content.appendChild(top);

  const bottom = el('div', 'wv2-winner-bottom');
  bottom.appendChild(el('div', 'wv2-winner-latest', 'LATEST WINNER:'));

  const pill = el('div', 'wv2-winner-pill');
  if (winner.avatarUrl) {
    const avatar = el('img', 'wv2-winner-avatar');
    avatar.src = winner.avatarUrl;
    avatar.alt = '';
    avatar.addEventListener('error', () => {
      const initials = el('div', 'wv2-winner-initials', winner.name.charAt(0));
      avatar.replaceWith(initials);
    });
    pill.appendChild(avatar);
  } else {
    pill.appendChild(el('div', 'wv2-winner-initials', winner.name.charAt(0)));
  }
  const id = el('div', 'wv2-winner-id');
  id.appendChild(el('div', 'wv2-winner-name', winner.name));
  if (winner.location) id.appendChild(el('div', 'wv2-winner-loc', winner.location));
  pill.appendChild(id);
  bottom.appendChild(pill);

  const meta = el('div', 'wv2-winner-meta');
  const awarded = awardedAtDisplay(winner.awardedAt);
  if (awarded) {
    meta.appendChild(el('div', 'wv2-winner-awarded', `This prize awarded on ${awarded}`));
  }
  meta.appendChild(el('div', 'wv2-winner-keepgoing', 'All new prize available now! Keep going!'));
  bottom.appendChild(meta);
  content.appendChild(bottom);

  card.appendChild(content);

  const close = el('button', 'wv2-modal-close');
  close.appendChild(icon(closeIcon, 'wv2-ic'));
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', onDismiss);
  card.appendChild(close);

  layer.appendChild(card);
  return layer;
}

/**
 * Config for the shared 6-digit code screen. The adoption OTP and the soft
 * email-verification flow render the SAME component through here — only the
 * copy, the submit/resend callables, and the presence of a back/cancel differ.
 */
interface CodeScreenConfig {
  title: string;
  subtitle: string;
  /** Called with the 6 collected digits (on the CTA tap and on auto-submit). */
  onSubmit: (code: string) => void;
  /** Called when the "Send a new code" action is tapped. */
  onResend: () => void;
  /**
   * When set, the header shows a back chevron that dismisses the screen — the
   * soft-verification flow is dismissible; the adoption gate is not.
   */
  onCancel?: () => void;
}

/**
 * The ONE 6-digit code screen. One input, autocomplete="one-time-code" so
 * mobile keyboards offer the code from the mail app; auto-submits at 6 digits.
 * The verifying/error state comes from the controller (`isVerifyingCode`,
 * `codeError`), so both flows share the same fixed error copy by construction.
 */
function renderCodeScreen(
  c: V2ExperienceController,
  cfg: CodeScreenConfig,
  logoUrl?: string | null
): HTMLElement {
  const root = el('div', 'wv2-screen wv2-capture');
  // The code screen scrolls like every other input screen — without this,
  // short viewports (and any open software keyboard) trapped the VERIFY
  // button, "Send a new code" and the legal footer with no way to reach them.
  const scroll = el('div', 'wv2-scroll');
  const stack = el('div', 'wv2-capture-stack');
  stack.appendChild(
    renderHeader({
      logoUrl,
      ...(cfg.onCancel ? { showsBack: true, onBack: cfg.onCancel } : {}),
      onInfo: () => c.showHowItWorks(),
      onClose: () => c.requestDismiss(),
    })
  );

  const titles = el('div', 'wv2-capture-titles');
  const h = el('div', 'wv2-capture-title');
  h.textContent = cfg.title;
  const sub = el('div', 'wv2-code-sub');
  sub.textContent = cfg.subtitle;
  titles.appendChild(h);
  titles.appendChild(sub);
  stack.appendChild(titles);

  const form = el('div', 'wv2-capture-form');
  const field = el('div', 'wv2-email-field');
  const input = el('input', 'wv2-email-input wv2-code-input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.placeholder = '••••••';
  input.maxLength = 6;
  field.appendChild(input);
  form.appendChild(field);

  if (c.codeError) {
    const err = el('div', 'wv2-code-error');
    err.textContent = c.codeError;
    form.appendChild(err);
  }

  const cta = document.createElement('button');
  cta.className = 'wv2-pill';
  cta.textContent = c.isVerifyingCode ? 'CHECKING…' : 'VERIFY';
  cta.disabled = c.isVerifyingCode;
  const submit = (): void => {
    const code = input.value.replace(/\D/g, '');
    if (code.length === 6) cfg.onSubmit(code);
  };
  cta.addEventListener('click', submit);
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) submit();   // auto-submit on the sixth digit
  });
  form.appendChild(cta);

  // Two-tone: the question reads as copy, the underlined action reads as a
  // control — without the underline, nothing on a touch screen says "tappable".
  const resend = document.createElement('button');
  resend.className = 'wv2-code-resend';
  const q = document.createElement('span');
  q.textContent = "Didn't get it? ";
  const action = document.createElement('span');
  action.className = 'wv2-code-resend-action';
  action.textContent = 'Send a new code';
  resend.appendChild(q);
  resend.appendChild(action);
  resend.addEventListener('click', () => cfg.onResend());
  form.appendChild(resend);

  stack.appendChild(form);

  // Same legal footer as the capture screen — the code screen is one step of
  // the same consent flow, and without it the sheet trails off into a void.
  // It lives INSIDE the scrolling stack (bottom-anchored via margin-top:auto,
  // same as the capture screen's legal block) so it stays reachable when the
  // keyboard shrinks the visible area.
  const legal = el('div', 'wv2-code-legal');
  legal.appendChild(renderLegalLinks(c, true));
  stack.appendChild(legal);
  scroll.appendChild(stack);
  root.appendChild(scroll);
  setTimeout(() => input.focus(), 50);
  return root;
}

/**
 * Verification code entry — shown when the typed email matches an EXISTING
 * account and the OTP gate is on. Reuses {@link renderCodeScreen}.
 *
 * The RE-ENTRY variant (2.9, `state.reentry`) is the same screen reached
 * from a fresh drawer-open after the register response reported
 * `adoptionPending`: the raw email is no longer in memory, so the subtitle
 * reads "Pick up where you left off" (the code was just re-sent by
 * restageAdoption) and resends route through restageAdoption too.
 */
export function renderCodeEntry(c: V2ExperienceController, logoUrl?: string | null): HTMLElement {
  if (c.state.kind !== 'codeEntry') return el('div');
  const email = c.state.email;
  const subtitle =
    c.state.reentry || !email
      ? AvafliV2Strings.adoptionReentrySubtitle
      : `This email is already part of an Avafli streak. Enter the 6-digit code we sent to ${email} to pick it up on this device.`;
  return renderCodeScreen(
    c,
    {
      title: 'CHECK YOUR EMAIL',
      subtitle,
      onSubmit: (code) => void c.submitVerificationCode(code),
      onResend: () => void c.resendVerificationCode(),
    },
    logoUrl
  );
}

/**
 * Soft email-verification — the SAME 6-digit code screen as adoption, reached
 * from the dashboard's "Verify your email" chip. Dismissible (a back chevron
 * returns to the dashboard); it gates nothing.
 */
export function renderEmailVerify(c: V2ExperienceController, logoUrl?: string | null): HTMLElement {
  if (c.state.kind !== 'emailVerify') return el('div');
  return renderCodeScreen(
    c,
    {
      title: AvafliV2Strings.verifyEmailTitle,
      subtitle: AvafliV2Strings.verifyEmailSubtitle,
      onSubmit: (code) => void c.confirmEmailVerificationCode(code),
      onResend: () => void c.resendEmailVerificationCode(),
      onCancel: () => c.cancelEmailVerify(),
    },
    logoUrl
  );
}

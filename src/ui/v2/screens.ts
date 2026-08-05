import { Giveaway, GiveawayWinner, PrizeClaimBlock } from '../../types';
import { V2_IMAGES } from './assets.generated';
import {
  CONFETTI_BURST_DURATION_MS,
  createAnimatedCheck,
  createConfetti,
  mountGifBurst,
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
import { V2ExperienceController } from './controller';
import {
  CLAIM_COUNTRY,
  PrizeClaimForm,
  US_STATES,
  claimDisplayName,
  claimPhotoBase64Jpeg,
  isClaimFormValid,
  isStep1Valid,
  isStep2Valid,
  monthYearDisplay,
} from './claim';
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
    const img = el('img');
    img.src = options.logoUrl;
    img.alt = '';
    logo.appendChild(img);
  } else {
    logo.appendChild(el('span', 'wv2-header-logo-fallback', 'WINR'));
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

function openUrl(url?: string): void {
  if (url) window.open(url, '_blank', 'noopener');
}

export function renderLegalLinks(rulesUrl?: string, showPoweredBy = false): HTMLElement {
  const wrap = el('div', 'wv2-legal');
  const row = el('div', 'wv2-legal-row');
  const rules = el('a', undefined, 'OFFICIAL RULES');
  rules.setAttribute('role', 'button');
  rules.href = rulesUrl || '#';
  rules.addEventListener('click', (e) => {
    e.preventDefault();
    openUrl(rulesUrl);
  });
  const privacy = el('a', undefined, 'PRIVACY POLICY');
  privacy.href = rulesUrl || '#';
  privacy.addEventListener('click', (e) => {
    e.preventDefault();
    openUrl(rulesUrl);
  });
  row.appendChild(rules);
  row.appendChild(el('span', 'wv2-legal-dot'));
  row.appendChild(privacy);
  wrap.appendChild(row);
  if (showPoweredBy) {
    wrap.appendChild(el('div', 'wv2-powered', 'Powered by © WINR Media'));
  }
  return wrap;
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

// ─── New-user capture ("VISIT. EARN. WIN.") ───

export function renderCapture(c: V2ExperienceController, logoUrl?: string | null): HTMLElement {
  const giveaway = c.giveaway;
  const day1Entries = c.ladderValue(1);

  const screen = el('div', 'wv2-screen');
  screen.appendChild(el('div', 'wv2-top-glow'));

  const scroll = el('div', 'wv2-scroll');
  scroll.style.position = 'relative';
  const stack = el('div', 'wv2-capture-stack');

  stack.appendChild(
    renderHeader({
      logoUrl,
      onInfo: () => c.showHowItWorks(),
      onClose: () => c.requestDismiss(),
    })
  );

  const titles = el('div', 'wv2-capture-titles');
  titles.appendChild(el('div', 'wv2-capture-title', 'VISIT. EARN. WIN.'));
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
  field.appendChild(input);
  form.appendChild(field);

  let isAdult = false;
  const ageRow = el('button', 'wv2-age-row');
  ageRow.type = 'button';
  const box = icon(squareIcon, 'wv2-ic');
  box.style.color = '#fff';
  ageRow.appendChild(box);
  ageRow.appendChild(el('span', undefined, 'I confirm I am 18 years of age or older'));
  form.appendChild(ageRow);

  const canSubmit = (): boolean =>
    isAdult && input.value.includes('@') && input.value.includes('.');

  const cta = renderPill(
    `CLAIM MY ${day1Entries} ENTRIES`,
    () => {
      void c.submitEmail(input.value.trim());
    },
    { loading: c.isSubmittingEmail, disabled: !canSubmit() }
  );
  form.appendChild(cta);
  stack.appendChild(form);

  const refreshCta = (): void => {
    cta.disabled = !canSubmit() || c.isSubmittingEmail;
    cta.classList.toggle('wv2-pill-dim', !canSubmit());
  };
  input.addEventListener('input', refreshCta);
  ageRow.addEventListener('click', () => {
    isAdult = !isAdult;
    box.innerHTML = isAdult ? checkSquareIcon : squareIcon;
    refreshCta();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && canSubmit()) void c.submitEmail(input.value.trim());
  });

  // Legal footer
  const legal = el('div', 'wv2-capture-legal');
  legal.appendChild(
    el(
      'div',
      'wv2-capture-disclaimer',
      'Your email lets us contact you if you win. By entering you agree to the Official Rules & Privacy Policy'
    )
  );
  legal.appendChild(renderLegalLinks(c.rulesUrl, true));
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

  if (c.giveaway?.latestWinner) {
    body.appendChild(renderWinnerBanner(onWinnerTap));
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
  footer.appendChild(renderLegalLinks(c.rulesUrl));
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
    // scattered around the tile.
    const confetti = createConfetti({ style: 'celebration', count: 12, speed: 0.7 });
    confetti.classList.add('wv2-tile-confetti');
    box.appendChild(confetti);
  }
  box.appendChild(tile);
  if (state === 'active') {
    // …plus the one-shot Figma confetti-burst GIF overflowing the tile.
    mountTileBurst(box);
  }
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

  screen.appendChild(scroll);
  return screen;
}

// ═══ Winner prize-claim flow (splash → 4 steps + review → confirmation) ═══
// Ported from iOS WINRV2Claim.swift + WINRV2ClaimSteps/ (Joe's stepped
// Figma design).

/** Claim-flow header: publisher logo centered, X close only (no "?"). */
function renderClaimHeader(logoUrl: string | null | undefined, onClose: () => void): HTMLElement {
  const header = el('div', 'wv2-claim-header');

  const logo = el('div', 'wv2-header-logo');
  if (logoUrl) {
    const img = el('img');
    img.src = logoUrl;
    img.alt = '';
    logo.appendChild(img);
  } else {
    logo.appendChild(el('span', 'wv2-header-logo-fallback', 'WINR'));
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
  return screen;
}

// ─── Stepped claim form (Joe's Figma flow: 4 steps + review) ───
// Ported from iOS WINRV2ClaimSteps/: a persistent gold-sparkle backdrop +
// header + animated step indicator, with the four form steps and the review
// screen sliding horizontally beneath them (push left on advance, push right
// on back).

/** The five screens of the stepped form (5 = review, no step indicator). */
type ClaimFlowStep = 1 | 2 | 3 | 4 | 5;

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
    const img = el('img');
    img.src = logoUrl;
    img.alt = '';
    logo.appendChild(img);
  } else {
    logo.appendChild(el('span', 'wv2-header-logo-fallback', 'WINR'));
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

  // "STEP N OF 4" + the row of 4 dots connected by accent lines. The fill
  // animates via CSS transitions; hidden on the review screen.
  const indicator = el('div', 'wv2-step-indicator');
  const stepLabel = el('div', 'wv2-step-label');
  indicator.appendChild(stepLabel);
  const dotsRow = el('div', 'wv2-step-dots');
  const dots: HTMLElement[] = [];
  for (let i = 1; i <= 4; i++) {
    const dot = el('div', 'wv2-step-dot');
    dots.push(dot);
    dotsRow.appendChild(dot);
    if (i < 4) dotsRow.appendChild(el('div', 'wv2-step-line'));
  }
  indicator.appendChild(dotsRow);
  flow.appendChild(indicator);

  // Pages viewport: steps slide horizontally beneath the fixed chrome.
  const pages = el('div', 'wv2-claim-pages');
  flow.appendChild(pages);
  screen.appendChild(flow);

  const syncChrome = (): void => {
    back.style.visibility = step === 1 ? 'hidden' : 'visible';
    if (step === 5) {
      indicator.classList.add('wv2-step-indicator-hidden');
    } else {
      indicator.classList.remove('wv2-step-indicator-hidden');
      stepLabel.textContent = `STEP ${step} OF 4`;
      indicator.setAttribute('aria-label', `Step ${step} of 4`);
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
    const { page, refresh } = buildPage(
      {
        title: 'TELL US ABOUT YOURSELF',
        subtitle:
          "We'll use this information to verify your prize and personalize your winner announcement.",
        ctaEnabled: () => isStep1Valid(form),
        onCTA: () => go(2),
      },
      fields
    );
    fields.appendChild(
      stepField({ label: 'First Name', key: 'firstName', refresh, autocomplete: 'given-name' })
    );
    fields.appendChild(
      stepField({
        label: 'Last Name (we will only show your last initial)',
        key: 'lastName',
        refresh,
        autocomplete: 'family-name',
      })
    );
    // The winning email lives server-side (the SDK never stores the raw
    // address) and the claim is keyed to the account — shown locked, masked
    // by the backend for recognition.
    fields.appendChild(
      lockedField({
        label: 'Winning Email Address (cannot be changed)',
        value: claim.maskedEmail || 'On file with your winning entry',
      })
    );
    fields.appendChild(
      stepField({
        label: 'Phone Number (optional)',
        key: 'phone',
        refresh,
        type: 'tel',
        autocomplete: 'tel',
        inputmode: 'tel',
      })
    );
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
    fields.appendChild(
      stepField({ label: 'Street Address', key: 'street', refresh, autocomplete: 'address-line1' })
    );
    fields.appendChild(
      stepField({
        label: 'Apartment, Suite, etc. (optional)',
        key: 'apt',
        refresh,
        autocomplete: 'address-line2',
      })
    );
    fields.appendChild(
      stepField({ label: 'City', key: 'city', refresh, autocomplete: 'address-level2' })
    );

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

  // ── Step 4: PLEASE SHARE A LITTLE ──

  /** Generic share line for the social buttons. */
  const shareLine = (): string => {
    const prize = stripHeadline(claim.prizeDescription, Math.round(claim.prizeValue));
    const site = document.title.trim();
    return site ? `I just won ${prize} on ${site}!` : `I just won ${prize}!`;
  };

  /** Best-effort share: the native share sheet where available, otherwise
      copy the line to the clipboard. */
  const share = (): void => {
    const text = shareLine();
    const nav = navigator as Navigator & { share?: (data: { text: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      nav.share({ text }).catch(() => undefined);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
  };

  const renderStep4 = (): HTMLElement => {
    const content = el('div', 'wv2-step4');

    const storyWrap = el('div', 'wv2-story');
    const story = el('textarea', 'wv2-story-input');
    story.placeholder =
      'Please share anything. What you’re going to do with the prize, why you love our app, your favorite food, etc.';
    story.value = form.story;
    story.addEventListener('input', () => {
      form.story = story.value;
    });
    storyWrap.appendChild(story);
    content.appendChild(storyWrap);

    const social = el('div', 'wv2-social');
    social.appendChild(el('div', 'wv2-social-title', 'Share on Social Media:'));
    const socialRow = el('div', 'wv2-social-row');
    const glyphs: Array<[string, string]> = [
      [socialInstagramIcon, 'Instagram'],
      [socialFacebookIcon, 'Facebook'],
      [socialXIcon, 'X'],
      [socialSnapchatIcon, 'Snapchat'],
      [socialTiktokIcon, 'TikTok'],
    ];
    for (const [glyph, name] of glyphs) {
      const btn = el('button', 'wv2-social-btn');
      btn.type = 'button';
      btn.appendChild(icon(glyph, 'wv2-social-glyph'));
      btn.setAttribute('aria-label', `Share on ${name}`);
      btn.addEventListener('click', share);
      socialRow.appendChild(btn);
    }
    social.appendChild(socialRow);
    content.appendChild(social);

    const { page } = buildPage(
      {
        title: 'PLEASE SHARE A LITTLE',
        subtitle: 'This helps us show real people like you win!',
        onCTA: () => go(5),
      },
      content
    );
    return page;
  };

  // ── Review: ALMOST DONE! ──

  const renderReview = (): HTMLElement => {
    const content = el('div', 'wv2-review');

    const consents = el('div', 'wv2-consents');
    type ConsentKey = 'confirmsAccuracy' | 'authorizesLikeness' | 'agreesToRules';
    const consentRow = (key: ConsentKey, label: HTMLElement): HTMLElement => {
      const btnRow = el('button', 'wv2-consent-row');
      btnRow.type = 'button';
      const box = el('span', 'wv2-consent-box');
      box.innerHTML = checkIconSvg;
      btnRow.appendChild(box);
      btnRow.appendChild(label);
      const sync = (): void => {
        box.classList.toggle('wv2-consent-on', form[key]);
        btnRow.setAttribute('aria-pressed', String(form[key]));
      };
      btnRow.addEventListener('click', () => {
        form[key] = !form[key];
        sync();
        refresh();
      });
      sync();
      return btnRow;
    };
    consents.appendChild(
      consentRow(
        'confirmsAccuracy',
        el('span', 'wv2-consent-text', 'I confirm my information is accurate.')
      )
    );
    consents.appendChild(
      consentRow(
        'authorizesLikeness',
        el(
          'span',
          'wv2-consent-text',
          "I authorize this app's publisher and its promotional partners to use my name, city, profile photo, and likeness for winner announcements and promotional purposes."
        )
      )
    );
    const rulesText = el('span', 'wv2-consent-text');
    rulesText.appendChild(document.createTextNode('I agree to the '));
    rulesText.appendChild(el('span', 'wv2-consent-em', 'Official Rules'));
    rulesText.appendChild(document.createTextNode(' and '));
    rulesText.appendChild(el('span', 'wv2-consent-em', 'Privacy Policy'));
    rulesText.appendChild(document.createTextNode('.'));
    consents.appendChild(consentRow('agreesToRules', rulesText));
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

    const { page, refresh } = buildPage(
      {
        title: 'ALMOST DONE!',
        subtitle: 'Please review and agree to claim your prize.',
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
        return renderStep4();
      case 5:
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
  '<path d="M1.5 5.5L5.2 9.2L12.5 1.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
  const mailRing = el('div', 'wv2-claim-mail-ring');
  mailRing.appendChild(icon(mailIcon, 'wv2-claim-mail'));
  const mailCol = el('div', 'wv2-claim-mail-col');
  mailCol.appendChild(el('div', 'wv2-claim-mail-line', 'Expect to receive your prize within'));
  mailCol.appendChild(el('div', 'wv2-claim-mail-days', '3-5 Business Days'));
  stack.appendChild(renderClaimInfoCard(mailRing, mailCol));

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

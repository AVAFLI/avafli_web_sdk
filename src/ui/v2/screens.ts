import { Giveaway, GiveawayWinner } from '../../types';
import { V2_IMAGES } from './assets.generated';
import { createAnimatedCheck, createConfetti } from './effects';
import {
  arrowDownIcon,
  calendarIcon,
  checkSquareIcon,
  chevronLeftIcon,
  closeIcon,
  flameIcon,
  lockIcon,
  mailIcon,
  plusIcon,
  squareIcon,
  ticketIcon,
} from './icons';
import { V2ExperienceController } from './controller';
import {
  awardedAtDisplay,
  formatInt,
  isCashPrize,
  prizeArticle,
  showsValueLine,
} from './v2-theme';

/**
 * The V2 experience screens, ported from iOS WINRV2Screens/Components/Winner:
 * new-user capture, return-user dashboard, celebration modal, how-it-works,
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

export function renderLoading(): HTMLElement {
  const screen = el('div', 'wv2-screen');
  const center = el('div', 'wv2-center-state');
  center.appendChild(el('span', 'wv2-spinner'));
  center.appendChild(el('div', 'wv2-loading-text', 'Loading…'));
  screen.appendChild(center);
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
    `GET MY ${day1Entries} ENTRIES`,
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

export function renderDashboard(
  c: V2ExperienceController,
  logoUrl: string | null | undefined,
  onWinnerTap: () => void
): HTMLElement {
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

  body.appendChild(renderPrizeCard(c));
  body.appendChild(renderStreakRail(c));
  body.appendChild(renderComeBackBar(c));

  const footer = el('div', 'wv2-dash-footer');
  const pillWrap = el('div', 'wv2-pill-wrap');
  pillWrap.appendChild(renderPill('GOT IT', () => c.requestDismiss()));
  footer.appendChild(pillWrap);
  footer.appendChild(renderLegalLinks(c.rulesUrl));
  body.appendChild(footer);

  scroll.appendChild(body);
  screen.appendChild(scroll);
  return screen;
}

/**
 * Day 2+ prize card: white stats strip (streak + total entries) over the prize
 * image. The image is publisher-configurable (prizeImageUrl); default is the
 * bundled cash pile with the prize-derived headline overlaid.
 */
function renderPrizeCard(c: V2ExperienceController): HTMLElement {
  const giveaway = c.giveaway;
  const description = giveaway?.prizeDescription ?? '';
  const value = Math.round(giveaway?.prizeValue ?? 0);
  const noun = c.visitMode ? 'VISIT' : 'DAY';

  const card = el('div', 'wv2-prize-card');

  // Stats strip
  const strip = el('div', 'wv2-stats-strip');
  const streakStat = el('div', 'wv2-stat');
  streakStat.appendChild(icon(flameIcon, 'wv2-ic-flame'));
  const streakCol = el('div', 'wv2-stat-col');
  streakCol.appendChild(el('div', 'wv2-stat-num', `${c.streakDay} ${noun} STREAK`));
  streakCol.appendChild(el('div', 'wv2-stat-label', 'Keep it going!'));
  streakStat.appendChild(streakCol);
  strip.appendChild(streakStat);

  const entriesStat = el('div', 'wv2-stat');
  entriesStat.appendChild(icon(ticketIcon, 'wv2-ic-ticket'));
  const entriesCol = el('div', 'wv2-stat-col');
  entriesCol.appendChild(el('div', 'wv2-stat-num', formatInt(c.totalEntries)));
  entriesCol.appendChild(el('div', 'wv2-stat-label', 'Total Entries'));
  entriesStat.appendChild(entriesCol);
  strip.appendChild(entriesStat);
  card.appendChild(strip);

  // Promo
  const promo = el('div', 'wv2-promo');
  if (giveaway?.prizeImageUrl) {
    // Publisher-supplied prize art fills the card as-is.
    const img = el('img', 'wv2-promo-img');
    img.src = giveaway.prizeImageUrl;
    img.alt = '';
    promo.appendChild(img);
  } else {
    // Default: bundled cash pile fading up into white, with the prize-derived
    // headline over the fade (Figma cash card).
    const img = el('img', 'wv2-promo-img wv2-promo-cash');
    img.src = V2_IMAGES.cashHero;
    img.alt = '';
    promo.appendChild(img);
    promo.appendChild(el('div', 'wv2-promo-fade'));

    if (isCashPrize(description)) {
      // Figma cash lockup: "WIN $1,000" over "CASH PRIZE", right-aligned.
      const lockup = el('div', 'wv2-promo-cash-lockup');
      lockup.appendChild(el('div', 'wv2-promo-cash-win', `WIN $${formatInt(value)}`));
      lockup.appendChild(el('div', 'wv2-promo-cash-sub', 'CASH PRIZE'));
      promo.appendChild(lockup);
    } else {
      // "WIN A $500 AMAZON GIFT CARD" + "$500.00 Value!"
      const lockup = el('div', 'wv2-promo-prize-lockup');
      lockup.appendChild(
        el(
          'div',
          'wv2-promo-prize-title',
          `WIN ${prizeArticle(description, true)} ${description.toUpperCase()}`
        )
      );
      if (showsValueLine(description, value)) {
        lockup.appendChild(el('div', 'wv2-promo-prize-value', `$${formatInt(value)}.00 Value!`));
      }
      promo.appendChild(lockup);
    }
  }
  card.appendChild(promo);
  return card;
}

// ─── Streak rail (STREAK STEP + MILESTONE tiles) ───

function renderStreakRail(c: V2ExperienceController): HTMLElement {
  const rail = el('div', 'wv2-rail');
  const noun = c.visitMode ? 'VISIT' : 'DAY';
  const streakDay = c.streakDay;
  const maxDay = Math.max(31, streakDay + 2);
  const milestoneDays = new Map<number, number>();
  for (const m of c.giveaway?.milestones ?? []) milestoneDays.set(m.day, m.bonusEntries);

  let activeItem: HTMLElement | null = null;

  for (let day = 1; day <= maxDay; day++) {
    const state: 'completed' | 'active' | 'locked' =
      day < streakDay ? 'completed' : day === streakDay ? 'active' : 'locked';

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

function renderStreakTile(
  day: number,
  entries: number,
  state: 'completed' | 'active' | 'locked',
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

function renderComeBackBar(c: V2ExperienceController): HTMLElement {
  const bar = el('div', 'wv2-comeback');
  bar.appendChild(icon(calendarIcon, 'wv2-ic-cal'));
  const col = el('div', 'wv2-comeback-col');
  col.appendChild(
    el(
      'div',
      'wv2-comeback-line',
      c.visitMode
        ? 'Come back again to receive:'
        : 'Come back tomorrow to\nkeep your streak alive and receive:'
    )
  );
  col.appendChild(el('div', 'wv2-comeback-entries', `${formatInt(c.nextEntries)} ENTRIES`));
  bar.appendChild(col);
  // Joe's toast has celebratory sprinkles drifting over the reward line.
  bar.appendChild(createConfetti({ style: 'celebration', count: 10, speed: 0.55 }));
  return bar;
}

// ─── Celebration modal (Day 1 "You're in!" / Day 2+ streak) ───

export function renderCelebrationModal(
  c: V2ExperienceController,
  earned: { baseEntries: number; bonusEntries: number },
  onDismiss: () => void
): HTMLElement {
  const layer = el('div', 'wv2-modal-layer');
  layer.appendChild(el('div', 'wv2-modal-dim')); // explicit dismiss only — no tap-through

  const streakDay = c.streakDay;
  const isFirstDay = streakDay <= 1;
  const visitMode = c.visitMode;
  const earnedEntries = earned.baseEntries + earned.bonusEntries;
  const nextEntries = c.nextEntries;

  const card = el('div', 'wv2-celebration-card');

  // Animated draw-on checkmark.
  const check = el('div', 'wv2-celebration-check');
  check.appendChild(createAnimatedCheck(7));
  card.appendChild(check);

  if (isFirstDay) {
    card.appendChild(el('div', 'wv2-celebration-youre-in', 'You’re in!'));
    card.appendChild(
      el('div', 'wv2-celebration-added', `${earnedEntries} ENTRIES HAVE BEEN ADDED`)
    );
  } else {
    card.appendChild(el('div', 'wv2-celebration-on-a', 'YOU’RE ON A'));
    card.appendChild(
      el('div', 'wv2-celebration-streak', `${streakDay} ${visitMode ? 'VISIT' : 'DAY'} STREAK!`)
    );
  }

  card.appendChild(el('div', 'wv2-celebration-divider'));

  const bigNumber = (value: number): HTMLElement => {
    const wrap = el('div', 'wv2-bignum');
    wrap.appendChild(el('div', 'wv2-bignum-value', formatInt(value)));
    wrap.appendChild(el('div', 'wv2-bignum-entries', 'ENTRIES'));
    return wrap;
  };

  if (isFirstDay) {
    card.appendChild(
      el(
        'div',
        'wv2-celebration-comeback-line',
        visitMode
          ? 'NEXT TIME YOU VISIT GET'
          : 'COME BACK TOMORROW TO KEEP\nYOUR STREAK GOING AND GET'
      )
    );
    card.appendChild(bigNumber(nextEntries));
  } else {
    card.appendChild(el('div', 'wv2-celebration-earned', 'YOU EARNED'));
    card.appendChild(bigNumber(earnedEntries));
    const next = el('div', 'wv2-celebration-next');
    next.appendChild(icon(calendarIcon, 'wv2-ic-cal'));
    const col = el('div', 'wv2-celebration-next-col');
    col.appendChild(
      el(
        'div',
        'wv2-celebration-next-line',
        visitMode ? 'Come back again for' : 'Come back tomorrow for'
      )
    );
    col.appendChild(el('div', 'wv2-celebration-next-entries', `${formatInt(nextEntries)} ENTRIES`));
    next.appendChild(col);
    card.appendChild(next);
  }

  const cta = el('div', 'wv2-celebration-cta');
  cta.appendChild(renderPill('GOT IT', onDismiss));
  card.appendChild(cta);

  // Confetti flutters over the upper card, like Joe's GIF (looping).
  const confettiWrap = el('div', 'wv2-celebration-confetti');
  confettiWrap.appendChild(createConfetti({ style: 'celebration', count: 34 }));
  card.appendChild(confettiWrap);

  const close = el('button', 'wv2-modal-close');
  close.appendChild(icon(closeIcon, 'wv2-ic'));
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', onDismiss);
  card.appendChild(close);

  layer.appendChild(card);
  return layer;
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

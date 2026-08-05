import { V2_COLORS, V2_INTER, V2_OSWALD } from './v2-theme';

/**
 * V2 experience stylesheet — pixel values ported 1:1 from the iOS SwiftUI
 * implementation (WINRV2Components/Screens/Winner/Effects.swift; 1pt = 1px).
 *
 * Injected inside the experience's SHADOW ROOT so host-page CSS can't leak in
 * and V2 CSS can't leak out. The publisher accent flows through the
 * `--wv2-accent` custom property (plus pre-computed alpha variants) set on the
 * overlay element.
 *
 * Responsive split:
 *  - < 768px: bottom drawer exactly like iOS — flush to bottom/sides, top
 *    corners rounded 30px, ~90% viewport height, dim backdrop, slide-up.
 *  - >= 768px: the SAME content as a centered modal card (max-width 440px,
 *    rounded 24px, vertically centered, subtle scale/fade in).
 */
export function v2Styles(): string {
  const c = V2_COLORS;
  return `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
img { display: block; }

/* ═══ Overlay + sheet (drawer < 768px, centered modal >= 768px) ═══ */

.wv2-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147482998;
  overflow: hidden;
  font-family: ${V2_INTER};
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
.wv2-overlay.wv2-inline { position: absolute; }

.wv2-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.35s ease;
}
.wv2-open .wv2-backdrop { opacity: 1; }

.wv2-sheet {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 90vh;
  height: 90dvh;
  background: ${c.gunmetal};
  border-radius: 30px 30px 0 0;
  overflow: hidden;
  transform: translateY(105%);
  transition: transform 0.45s cubic-bezier(0.32, 0.72, 0.28, 1);
}
.wv2-open .wv2-sheet { transform: translateY(0); }
.wv2-closing .wv2-sheet { transform: translateY(105%); }
.wv2-closing .wv2-backdrop { opacity: 0; }

@media (min-width: 768px) {
  .wv2-sheet {
    left: 50%; top: 50%; right: auto; bottom: auto;
    width: min(440px, calc(100vw - 48px));
    height: min(760px, calc(100vh - 64px));
    height: min(760px, calc(100dvh - 64px));
    border-radius: 24px;
    transform: translate(-50%, -50%) scale(0.94);
    opacity: 0;
    transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.3s ease;
  }
  .wv2-open .wv2-sheet { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  .wv2-closing .wv2-sheet { transform: translate(-50%, -50%) scale(0.94); opacity: 0; }
  /* The grab handle is a drawer affordance — hide it on the centered modal. */
  .wv2-grabber { visibility: hidden; height: 0; margin-top: 8px; }
}

/* ═══ Shared screen scaffolding ═══ */

.wv2-screen { position: relative; height: 100%; display: flex; flex-direction: column; background: ${c.gunmetal}; }
.wv2-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; -ms-overflow-style: none; overscroll-behavior: contain; }
.wv2-scroll::-webkit-scrollbar { display: none; }

/* The radial primary-color glow that bleeds from the top of the drawer. */
.wv2-top-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(440px at 50% 0,
    var(--wv2-accent) 0,
    var(--wv2-accent-55) 35%,
    rgba(29, 35, 48, 0.9) 80%,
    ${c.gunmetal} 100%);
  opacity: 0.9;
  pointer-events: none;
}

/* Confetti canvases fill their positioned parent. NOTE: canvas is a replaced
   element, so "inset: 0" alone does NOT stretch it — explicit width/height
   are required (otherwise the draw loop would feed its own attribute size
   back into itself). */
.wv2-confetti {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  display: block;
  pointer-events: none;
}

/* Grab handle (Figma "TAB"). */
.wv2-grabber { width: 51px; height: 5px; border-radius: 999px; background: rgba(255,255,255,0.4); margin: 15px auto 0; flex: none; }

/* TOP UI: "?" circle • publisher logo • "X" circle. */
.wv2-header { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; gap: 8px; flex: none; }
.wv2-circle-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: ${c.deepCharcoal};
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex: none;
}
.wv2-circle-btn .wv2-ic { display: block; }
.wv2-circle-btn-q { font-family: ${V2_INTER}; font-size: 16px; font-weight: 400; }
.wv2-header-logo { height: 60px; max-width: 210px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.wv2-header-logo img { max-height: 60px; max-width: 210px; object-fit: contain; }
.wv2-header-logo-fallback { font-size: 28px; font-weight: 900; color: #fff; letter-spacing: -0.5px; }

/* CTA pill. */
.wv2-pill {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 60px; border-radius: 999px;
  background: var(--wv2-accent);
  color: #fff;
  font-size: 24px; font-weight: 800; letter-spacing: -0.72px;
  white-space: nowrap; overflow: hidden;
  transition: filter 0.15s ease, opacity 0.15s ease;
}
.wv2-pill:not(:disabled):hover { filter: brightness(1.07); }
.wv2-pill:not(:disabled):active { filter: brightness(0.93); }
.wv2-pill:disabled { cursor: default; }
.wv2-pill.wv2-pill-dim { opacity: 0.5; }
.wv2-spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.35); border-top-color: #fff;
  animation: wv2-spin 0.8s linear infinite;
}
@keyframes wv2-spin { to { transform: rotate(360deg); } }

/* Legal links. */
.wv2-legal { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.wv2-legal-row { display: flex; align-items: center; gap: 8px; }
.wv2-legal-row a { font-size: 12px; color: ${c.textSecondary}; text-decoration: none; }
.wv2-legal-row a:hover { text-decoration: underline; }
.wv2-legal-dot { width: 4px; height: 4px; border-radius: 50%; background: ${c.textSecondary}; }
.wv2-powered { font-size: 12px; color: ${c.textTertiary}; }

/* ═══ New-user capture ("VISIT. EARN. WIN.") ═══ */

.wv2-capture-stack { display: flex; flex-direction: column; gap: 18px; padding-top: 18px; }
.wv2-capture-titles { padding: 0 22px; text-align: center; color: #fff; display: flex; flex-direction: column; gap: 4px; }
.wv2-capture-title { font-size: 40px; font-weight: 900; letter-spacing: -1.2px; white-space: nowrap; }
.wv2-capture-sub { font-size: 15px; font-weight: 700; white-space: pre; }
@media (max-width: 379px) { .wv2-capture-title { font-size: 34px; } }

/* PRIZE-derived white strip. */
.wv2-prize-strip { background: #fff; color: ${c.gunmetal}; text-align: center; padding: 8px 12px; }
.wv2-prize-strip-cash { font-size: 24px; font-weight: 900; letter-spacing: -0.7px; white-space: nowrap; }
.wv2-prize-strip-title { font-size: 23px; font-weight: 900; letter-spacing: -0.7px; white-space: nowrap; }
.wv2-prize-strip-value { font-size: 16px; font-weight: 400; }
@media (max-width: 379px) {
  .wv2-prize-strip-cash, .wv2-prize-strip-title { font-size: 19px; }
}

.wv2-capture-form { display: flex; flex-direction: column; gap: 14px; padding: 0 22px; }
.wv2-email-field {
  display: flex; align-items: center; gap: 10px;
  height: 54px; padding: 0 20px;
  background: #fff; border-radius: 10px;
  border: 2px solid rgba(255,255,255,0.75);
}
.wv2-email-field .wv2-ic { width: 22px; height: 18px; color: rgba(29,35,48,0.6); flex: none; }
.wv2-email-input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: ${V2_INTER}; font-size: 16px; color: ${c.gunmetal};
}
.wv2-email-input::placeholder { color: rgba(29,35,48,0.45); }

/* Consent checkbox row — shared by BOTH capture-screen checkboxes (the 18+
   age gate and the email/marketing consent below it), so they stay
   pixel-identical. See renderConsentRow(). */
.wv2-age-row { display: flex; align-items: center; gap: 10px; color: #fff; text-align: left; }
.wv2-age-row .wv2-ic { width: 20px; height: 20px; flex: none; }
.wv2-age-row span { font-size: 14px; }

.wv2-capture-legal { display: flex; flex-direction: column; gap: 3px; padding-bottom: 24px; }
.wv2-capture-disclaimer {
  font-size: 12px; color: ${c.textTertiary}; text-align: center;
  padding: 0 30px; margin-bottom: 3px;
}

/* ═══ Return-user dashboard ═══ */

.wv2-dash-stack { display: flex; flex-direction: column; gap: 15px; padding-top: 15px; }
.wv2-dash-body { display: flex; flex-direction: column; gap: 15px; }

/* Prize card (Joe's Aug-2026 dark full-bleed revision): the art fills the
   whole card, a solid black stats strip sits inside the top edge, and the
   prize headline rides the bottom over a black→transparent scrim. */
.wv2-prize-card {
  position: relative;
  margin: 0 22px; height: 200px;
  border-radius: 10px; overflow: hidden;
  background: ${c.deepCharcoal};
}
/* The hero carries the card's own deep charcoal so a cold/erroring remote
   image never flashes blank or white behind it. */
.wv2-prize-hero {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  background: ${c.deepCharcoal};
}
/* Applied ONLY when the bytes weren't already warm (see renderPrizeHero):
   a short fade instead of a hard pop. A prewarmed image never gets this
   class, so it paints with the rest of the card. */
.wv2-prize-hero.wv2-img-fade { opacity: 0; transition: opacity 200ms ease-out; }
.wv2-prize-hero.wv2-img-fade.wv2-img-ready { opacity: 1; }
.wv2-stats-strip { position: absolute; top: 0; left: 0; right: 0; display: flex; height: 46px; background: #000; }
.wv2-stat { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; }
.wv2-stat .wv2-ic-flame { width: 18px; height: 22px; color: var(--wv2-accent); flex: none; }
.wv2-stat .wv2-ic-ticket { width: 22px; height: 15px; color: var(--wv2-accent); transform: rotate(-25deg); flex: none; }
.wv2-stat-col { display: flex; flex-direction: column; align-items: flex-start; }
.wv2-stat-num { font-size: 15px; font-weight: 900; letter-spacing: -0.3px; color: var(--wv2-accent); line-height: 1.2; position: relative; }
/* Joe's one-shot Figma confetti-burst GIF popped over the total as the
   count-up lands (54x44, per the iOS frame). */
.wv2-count-burst {
  position: absolute;
  left: 50%; top: 50%;
  width: 54px; height: 44px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.wv2-stat-label { font-size: 12px; font-weight: 500; color: #fff; line-height: 1.2; }

.wv2-prize-headline {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 34px 14px 10px;
  background: linear-gradient(to bottom, rgba(0,0,0,0) 0, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.9) 100%);
}
.wv2-ph-cash { display: flex; flex-direction: column; align-items: flex-end; color: #fff; }
.wv2-ph-cash-win { font-size: 44px; font-weight: 900; letter-spacing: -2.2px; line-height: 1; white-space: nowrap; }
.wv2-ph-cash-sub { font-size: 19px; font-weight: 900; letter-spacing: -0.57px; margin-top: -2px; }
.wv2-ph-prize { text-align: center; }
.wv2-ph-prize-title { font-size: 28px; font-weight: 900; letter-spacing: -1px; line-height: 1.05; color: #fff; }
.wv2-ph-prize-value { font-size: 15px; font-weight: 900; color: var(--wv2-accent); }
@media (max-width: 379px) { .wv2-ph-cash-win { font-size: 38px; } .wv2-ph-prize-title { font-size: 24px; } }

/* Streak rail (horizontal scroll; internal scroll, hidden scrollbars). */
.wv2-rail {
  display: flex; align-items: flex-end; gap: 12px;
  overflow-x: auto; overflow-y: hidden;
  padding: 0 24px 12px;
  scrollbar-width: none; -ms-overflow-style: none;
  cursor: grab;
}
.wv2-rail::-webkit-scrollbar { display: none; }
.wv2-rail.wv2-dragging { cursor: grabbing; scroll-behavior: auto; }
.wv2-rail-item { display: flex; flex-direction: column; align-items: center; flex: none; }

/* The "DAILY PROGRESS ▾" pointer rides ABOVE the current tile. */
.wv2-pointer { display: flex; flex-direction: column; align-items: center; padding-bottom: 8px; visibility: hidden; }
.wv2-rail-item.wv2-current .wv2-pointer { visibility: visible; }
.wv2-pointer-label { font-family: ${V2_OSWALD}; font-weight: 500; font-size: 12px; color: #fff; white-space: nowrap; }
.wv2-pointer .wv2-ic { width: 10px; height: 6px; color: #fff; margin-top: 2px; }

/* Streak tile. */
.wv2-tile-box { position: relative; }
.wv2-tile {
  position: relative;
  z-index: 1;
  width: 106px; height: 134px;
  border-radius: 10px;
  border: 2px solid var(--wv2-accent);
  background: ${c.gunmetal};
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  padding: 8px 3px;
}
.wv2-tile-day {
  font-size: 12px; font-weight: 700; color: #fff;
  background: #000; border-radius: 999px; padding: 5px 10px;
  white-space: nowrap;
}
.wv2-tile-mid { display: flex; flex-direction: column; align-items: center; }
.wv2-tile-num { font-size: 30px; font-weight: 900; letter-spacing: -1.5px; color: #fff; line-height: 1.1; white-space: nowrap; }
.wv2-tile-entries { font-size: 15px; font-weight: 700; color: #fff; line-height: 1.1; }
.wv2-tile-icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
.wv2-tile-icon .wv2-ic-lock { width: 16px; height: 20px; color: ${c.foregroundSecondary}; }
.wv2-tile-icon img { width: 20px; height: 20px; }
.wv2-tile-icon .wv2-animated-check { width: 20px; height: 20px; }

.wv2-tile.wv2-completed .wv2-tile-num { color: var(--wv2-accent); }
.wv2-tile.wv2-locked .wv2-tile-num,
.wv2-tile.wv2-locked .wv2-tile-entries { color: ${c.foregroundSecondary}; }
.wv2-tile.wv2-active,
.wv2-tile.wv2-ready {
  background: radial-gradient(150px at 50% 0,
    var(--wv2-accent) 0,
    var(--wv2-accent-45) 45%,
    ${c.gunmetal} 100%);
}
.wv2-tile.wv2-active {
  animation: wv2-pulse-glow 1.1s ease-in-out infinite alternate;
}
/* "ready" (pre-reveal) is CALM — the active tile's radial accent bg with a
   STATIC glow (no pulse, no icon, no confetti). Every moving element waits
   for the single reveal beat. */
.wv2-tile.wv2-ready {
  box-shadow: 0 0 10px 0 var(--wv2-accent-75);
}
/* Joe's active-tile motion: the accent glow breathes. */
@keyframes wv2-pulse-glow {
  from { box-shadow: 0 0 7px 0 var(--wv2-accent-55); }
  to   { box-shadow: 0 0 14px 2px var(--wv2-accent-95); }
}
/* Confetti specks scattered around the active tile. */
.wv2-tile-confetti {
  position: absolute;
  width: 152px; height: 176px;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
/* Joe's one-shot confetti-burst GIF: centered on the active tile at ~150%
   of its size so the explosion overflows the tile bounds (.wv2-tile-box
   never clips), above the tile (z-index 1). */
.wv2-tile-burst {
  position: absolute;
  width: 200px; height: 200px;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  pointer-events: none;
}

/* The "STREAK BONUS!" accelerator tile. */
.wv2-powerup {
  width: 106px; height: 134px; flex: none;
  border-radius: 10px; background: var(--wv2-accent); color: #fff;
  display: flex; flex-direction: column; align-items: center;
  padding: 10px 3px; text-align: center;
}
.wv2-powerup .wv2-ic-flame { width: 18px; height: 24px; color: #fff; flex: none; }
.wv2-powerup-body { display: flex; flex-direction: column; gap: 7px; margin-top: auto; align-items: center; }
.wv2-powerup-label { font-size: 9px; font-weight: 700; line-height: 1.2; white-space: pre-line; }
.wv2-powerup-bonus { font-size: 26px; font-weight: 900; letter-spacing: -0.8px; line-height: 1; }
.wv2-powerup-every { font-size: 14px; font-weight: 900; margin-top: -2px; }
.wv2-powerup-footnote { font-family: ${V2_OSWALD}; font-weight: 700; font-size: 8px; }

/* Confirmation ("come back tomorrow") bar — on a CELEBRATION open the
   "YOU'RE ON A ROLL!" toast is the bar's FIRST visible state
   (.wv2-toast-start, static — no slide-in), and after the ~2.5s hold it
   slides ONCE to the come-back pitch (.wv2-untoasting), the bar's resting
   state. Non-celebration opens rest on the pitch from the start. */
.wv2-comeback {
  position: relative;
  height: 71px; background: #000;
  overflow: hidden;
}
.wv2-cb-come, .wv2-cb-claimed {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
.wv2-cb-come { gap: 14px; }
.wv2-cb-claimed { gap: 16px; padding: 0 16px; transform: translateX(100%); opacity: 0; }
/* Toast-first: the toast sits at rest and the pitch waits off-screen left —
   statically, so the very first painted frame is the toast. */
.wv2-comeback.wv2-toast-start .wv2-cb-come { transform: translateX(-100%); opacity: 0; }
.wv2-comeback.wv2-toast-start .wv2-cb-claimed { transform: translateX(0); opacity: 1; }
/* The single slide to the pitch: the toast exits LEFT while the pitch
   enters from the right — one continuous forward direction, no rewind. */
.wv2-comeback.wv2-untoasting .wv2-cb-claimed {
  animation: wv2-cb-out-left 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.wv2-comeback.wv2-untoasting .wv2-cb-come {
  animation: wv2-cb-in-right 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes wv2-cb-in-right {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
@keyframes wv2-cb-out-left {
  from { transform: translateX(0); opacity: 1; }
  to   { transform: translateX(-100%); opacity: 0; }
}
.wv2-comeback .wv2-ic-cal { width: 26px; height: 28px; color: var(--wv2-accent); flex: none; }
.wv2-comeback-col { display: flex; flex-direction: column; gap: 1px; text-align: center; color: #fff; }
.wv2-comeback-line { font-size: 12px; white-space: pre-line; }
.wv2-comeback-line strong { font-weight: 700; }
.wv2-comeback-entries { font-size: 16px; font-weight: 900; color: var(--wv2-accent); }
.wv2-cb-check { width: 38px; height: 38px; flex: none; }
.wv2-cb-check .wv2-animated-check { width: 38px; height: 38px; }
.wv2-cb-claimed-col { display: flex; flex-direction: column; text-align: center; min-width: 0; }
.wv2-cb-added {
  font-size: 20px; font-weight: 900; letter-spacing: -0.6px;
  color: var(--wv2-accent);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wv2-cb-roll { font-size: 13px; font-weight: 700; color: #fff; }
.wv2-comeback .wv2-confetti { position: absolute; inset: 0; }

.wv2-dash-footer { display: flex; flex-direction: column; gap: 6px; padding-bottom: 24px; }
.wv2-dash-footer .wv2-pill-wrap { padding: 0 30px; }

/* ═══ Winner banner + dialog ═══ */

.wv2-winner-banner {
  display: flex; align-items: center;
  width: 100%; height: 70px;
  background: ${c.deepCharcoal};
  padding: 8px 20px;
  color: #fff;
}
.wv2-winner-banner-trophy { width: 41px; height: 54px; object-fit: cover; transform: scaleX(-1); flex: none; }
.wv2-winner-banner-col { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 0 8px; }
.wv2-winner-banner-title { font-size: 17px; font-weight: 800; letter-spacing: -0.85px; }
.wv2-winner-banner-sub { font-size: 12px; letter-spacing: -0.6px; }
.wv2-winner-banner-plus {
  width: 36px; height: 36px; border-radius: 50%; background: ${c.gunmetal};
  display: flex; align-items: center; justify-content: center; flex: none;
}
.wv2-winner-banner-plus .wv2-ic { width: 18px; height: 18px; color: #fff; }

.wv2-modal-layer {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  z-index: 10;
}
.wv2-modal-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.55); }

.wv2-winner-card {
  position: relative;
  width: calc(100% - 32px); max-width: 380px;
  border-radius: 20px; overflow: hidden;
  border: 2px solid var(--wv2-accent);
  animation: wv2-modal-in 0.4s cubic-bezier(0.2, 0.8, 0.3, 1);
}
@keyframes wv2-modal-in {
  from { transform: scale(0.9); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}
.wv2-winner-bg { position: absolute; inset: 0; background: ${c.deepCharcoal}; }
.wv2-winner-bg img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.9; }
.wv2-winner-bg-grad {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom right, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%);
}
.wv2-winner-bg .wv2-confetti { position: absolute; inset: 0; }
.wv2-winner-content { position: relative; display: flex; flex-direction: column; gap: 7px; padding: 24px 0 22px; }
.wv2-winner-top { display: flex; align-items: center; }
.wv2-winner-trophy-wrap { width: 129px; display: flex; justify-content: center; flex: none; }
.wv2-winner-trophy { width: 114px; height: 153px; object-fit: contain; transform: rotate(-5.96deg); }
.wv2-winner-heading { flex: 1; display: flex; flex-direction: column; align-items: center; }
.wv2-winner-wehavea { font-size: 23px; font-weight: 700; letter-spacing: -1.15px; color: #fff; }
.wv2-winner-winner { font-size: 44px; font-weight: 900; letter-spacing: -2.2px; color: var(--wv2-accent); line-height: 1; white-space: nowrap; }
.wv2-winner-congrats { font-size: 15px; letter-spacing: -0.75px; color: #fff; text-align: center; width: 160px; margin-top: 4px; }
.wv2-winner-bottom { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.wv2-winner-latest { font-size: 19px; font-weight: 700; color: #fff; }
.wv2-winner-pill {
  display: flex; align-items: center; gap: 11px;
  height: 72px; padding: 0 20px 0 13px;
  border-radius: 999px;
  background: ${c.gunmetal};
  border: 2px solid var(--wv2-accent);
  max-width: calc(100% - 40px);
}
.wv2-winner-avatar { width: 51px; height: 51px; border-radius: 50%; object-fit: cover; flex: none; }
.wv2-winner-initials {
  width: 51px; height: 51px; border-radius: 50%; flex: none;
  background: var(--wv2-accent-35);
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 700; color: #fff;
}
.wv2-winner-id { display: flex; flex-direction: column; gap: 2px; color: #fff; overflow: hidden; }
.wv2-winner-name { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv2-winner-loc { font-size: 20px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv2-winner-meta { display: flex; flex-direction: column; gap: 3px; text-align: center; color: #fff; }
.wv2-winner-awarded { font-size: 16px; }
.wv2-winner-keepgoing { font-size: 16px; font-weight: 700; }
.wv2-modal-close {
  position: absolute; top: 12px; right: 12px;
  width: 36px; height: 36px; border-radius: 50%;
  background: ${c.gunmetal};
  display: flex; align-items: center; justify-content: center;
  z-index: 3;
}
.wv2-modal-close .wv2-ic { width: 11px; height: 11px; color: #fff; }

/* Draw-on checkmark strokes. */
.wv2-check-circle {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: wv2-draw 0.5s ease-in-out forwards;
}
.wv2-check-mark {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: wv2-draw 0.35s ease-out 0.4s forwards;
}
@keyframes wv2-draw { to { stroke-dashoffset: 0; } }

/* ═══ How it works ═══ */

.wv2-hiw { background: ${c.panel}; }
.wv2-hiw-stack { display: flex; flex-direction: column; gap: 12px; padding-top: 18px; }
.wv2-hiw-strip {
  height: 39px; background: rgba(255,255,255,0.5);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 900; letter-spacing: -0.78px; color: ${c.gunmetal};
}
.wv2-hiw-items { display: flex; flex-direction: column; gap: 14px; padding: 0 26px; }
.wv2-hiw-item { display: flex; gap: 9px; color: #fff; }
.wv2-hiw-item-num { font-size: 18px; font-weight: 900; flex: none; }
.wv2-hiw-item-col { display: flex; flex-direction: column; gap: 2px; }
.wv2-hiw-item-title { font-size: 18px; font-weight: 900; }
.wv2-hiw-item-body { font-size: 16px; }
.wv2-hiw-tagline {
  font-size: 20px; font-weight: 700; letter-spacing: -0.6px; color: #fff;
  text-align: center; padding: 22px 40px 0;
}
.wv2-hiw-cta { padding: 20px 28px 30px; }

/* ═══ Winner prize-claim flow (splash → form → confirmation) ═══
   Ported from iOS WINRV2Claim.swift (Joe's Light variant, 1pt = 1px). */

.wv2-claim-screen { background: ${c.deepCharcoal}; }
.wv2-claim-stack { display: flex; flex-direction: column; padding-top: 18px; }

/* Claim-flow header: publisher logo centered, X close only (no "?"). */
.wv2-claim-header {
  position: relative; flex: none;
  display: flex; align-items: center; justify-content: center;
  padding: 0 56px; min-height: 60px;
}
.wv2-claim-close { position: absolute; right: 20px; top: 50%; transform: translateY(-50%); }

/* Splash: trophy over the gold-sparkle art. */
.wv2-claim-trophy-art {
  position: relative; height: 280px; margin-top: 4px;
  display: flex; align-items: center; justify-content: center;
}
.wv2-claim-trophy-bg {
  position: absolute; left: 50%; top: 50%;
  width: 300px; height: 260px; object-fit: cover;
  transform: translate(-50%, -50%) rotate(-2deg);
}
.wv2-claim-trophy { position: relative; height: 230px; object-fit: contain; }

.wv2-claim-congrats {
  font-size: 34px; font-weight: 900; letter-spacing: -1px; color: #fff;
  text-align: center; padding: 2px 20px 0; white-space: nowrap;
}
@media (max-width: 379px) { .wv2-claim-congrats { font-size: 28px; } }
.wv2-claim-latest {
  font-size: 17px; font-weight: 900; letter-spacing: -0.4px;
  color: var(--wv2-accent); text-align: center;
}
.wv2-claim-youve-won { font-size: 14px; color: #fff; text-align: center; margin: 18px 0 8px; }

/* Full-width white strip with the prize-derived headline. */
.wv2-claim-strip {
  background: #fff; color: ${c.gunmetal};
  font-size: 28px; font-weight: 900; letter-spacing: -0.8px;
  text-align: center; padding: 14px 16px;
}
@media (max-width: 379px) { .wv2-claim-strip { font-size: 22px; } }

.wv2-claim-body-copy { font-size: 15px; color: #fff; text-align: center; padding: 16px 30px 0; }

/* Dark info card with a leading icon (shield/mail) — splash + confirmation. */
.wv2-claim-info-card {
  display: flex; align-items: center; gap: 14px;
  margin: 14px 22px 0; padding: 14px 18px;
  border-radius: 12px; background: rgba(255,255,255,0.08);
  text-align: left;
}
.wv2-claim-shield { width: 24px; height: 28px; color: var(--wv2-accent); flex: none; }
.wv2-claim-shield svg { width: 100%; height: 100%; }
.wv2-claim-info-text { font-size: 13px; color: #fff; }

.wv2-claim-cta { padding: 20px 30px 30px; }

/* Stepped form (WINRV2ClaimSteps): gold-sparkle full-bleed backdrop (406px)
   fading into the dark body, per the frames. */
.wv2-claim-form-bg { position: absolute; top: 0; left: 0; right: 0; height: 406px; overflow: hidden; }
.wv2-claim-form-bg img { width: 100%; height: 100%; object-fit: cover; }
.wv2-claim-form-bg-grad {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom,
    rgba(11, 13, 18, 0.1) 5%,
    rgba(11, 13, 18, 0.6) 60%,
    ${c.deepCharcoal} 100%);
}

.wv2-claim-flow { position: relative; height: 100%; display: flex; flex-direction: column; padding-top: 18px; }
.wv2-claim-back { position: absolute; left: 20px; top: 50%; transform: translateY(-50%); background: rgba(11, 13, 18, 0.85); }

/* "STEP N OF 4" + the row of 4 dots connected by accent lines: filled up to
   the current step, outlined after it. Removed on the review screen. */
.wv2-step-indicator { display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 8px; flex: none; }
.wv2-step-indicator.wv2-step-indicator-hidden { display: none; }
.wv2-step-label { font-size: 17px; font-weight: 600; letter-spacing: -0.85px; color: #fff; }
.wv2-step-dots { display: flex; align-items: center; }
.wv2-step-dot {
  width: 14px; height: 14px; border-radius: 50%;
  border: 1.5px solid var(--wv2-accent);
  background: rgba(11, 13, 18, 0.6);
  transition: background 0.3s ease;
}
.wv2-step-dot.wv2-filled { background: var(--wv2-accent); }
.wv2-step-line { width: 29px; height: 1.5px; background: var(--wv2-accent); }

/* Pages viewport: steps slide horizontally beneath the fixed chrome (push
   left on advance, push right on back). */
.wv2-claim-pages { position: relative; flex: 1; overflow: hidden; }
.wv2-claim-page {
  position: absolute; inset: 0;
  overflow-y: auto; overflow-x: hidden;
  scrollbar-width: none; -ms-overflow-style: none;
  overscroll-behavior: contain;
}
.wv2-claim-page::-webkit-scrollbar { display: none; }
.wv2-page-in-right { animation: wv2-slide-in-right 0.3s ease-in-out; }
.wv2-page-in-left { animation: wv2-slide-in-left 0.3s ease-in-out; }
.wv2-page-out-left { animation: wv2-slide-out-left 0.3s ease-in-out forwards; pointer-events: none; }
.wv2-page-out-right { animation: wv2-slide-out-right 0.3s ease-in-out forwards; pointer-events: none; }
@keyframes wv2-slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes wv2-slide-in-left { from { transform: translateX(-100%); } to { transform: translateX(0); } }
@keyframes wv2-slide-out-left { from { transform: translateX(0); } to { transform: translateX(-100%); } }
@keyframes wv2-slide-out-right { from { transform: translateX(0); } to { transform: translateX(100%); } }

/* Step page scaffold: Inter-Black 27 title, Inter-Medium 18 subtitle,
   content, accent CTA pill (50% while the step is invalid). */
.wv2-step-stack { display: flex; flex-direction: column; padding: 0 28px 34px; }
.wv2-step-title {
  font-size: 27px; font-weight: 900; letter-spacing: -0.81px; color: #fff;
  text-align: center; padding-top: 24px;
}
.wv2-step-subtitle { font-size: 18px; font-weight: 500; letter-spacing: -0.54px; color: #fff; text-align: center; padding-top: 7px; }
.wv2-step-cta { padding: 21px 12px 0; }

/* Claim-step fields per the frames: #212832 fill, #3D424B 1px border, r10,
   59px box, 20px input text, 12px label. */
.wv2-step-fields { display: flex; flex-direction: column; gap: 21px; padding: 34px 12px 0; }
.wv2-step-fields-address { padding-top: 28px; }
.wv2-sf { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.wv2-sf-label { font-size: 12px; color: #fff; padding-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv2-sf-input {
  height: 59px; padding: 0 25px; border-radius: 10px;
  background: #212832; border: 1px solid #3d424b;
  font-family: ${V2_INTER}; font-size: 20px; color: #fff;
  outline: none; width: 100%;
}
.wv2-sf-input:focus { border-color: rgba(255,255,255,0.45); }
.wv2-sf-locked {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  height: 59px; padding: 0 25px; border-radius: 10px;
  background: #212832; border: 1px solid #3d424b;
}
.wv2-sf-locked-value { font-size: 20px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv2-sf-dim { color: rgba(255,255,255,0.3); }
.wv2-sf-row { display: flex; align-items: flex-start; gap: 13px; }
.wv2-sf-state { flex: 1; }
.wv2-sf-zip { width: 101px; flex: none; }
.wv2-sf-select-wrap { position: relative; }
.wv2-sf-select {
  appearance: none; -webkit-appearance: none;
  height: 59px; width: 100%; padding: 0 44px 0 25px; border-radius: 10px;
  background: #212832; border: 1px solid #3d424b;
  font-family: ${V2_INTER}; font-size: 20px; color: #fff;
  outline: none; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wv2-sf-select.wv2-placeholder { color: rgba(255,255,255,0.3); }
/* The dropdown list renders natively (light) — keep its options legible. */
.wv2-sf-select option { color: ${c.gunmetal}; background: #fff; }
.wv2-sf-chevron { width: 13px; height: 9px; color: rgba(255,255,255,0.7); flex: none; }
.wv2-sf-select-wrap .wv2-sf-chevron { position: absolute; right: 25px; top: 50%; transform: translateY(-50%); pointer-events: none; }

/* Step 3: 242px circular preview with accent ring + camera badge breaking
   the bottom-right edge, UPLOAD/TAKE PHOTO outline buttons. */
.wv2-step3 { display: flex; flex-direction: column; align-items: center; padding-top: 26px; }
.wv2-claim-avatar {
  position: relative; width: 242px; height: 242px; border-radius: 50%;
  background: ${c.gunmetal};
  border: 2px solid var(--wv2-accent);
  margin-bottom: 19px;
}
.wv2-claim-avatar-img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.wv2-claim-avatar-person {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 110px; height: 110px; color: rgba(255,255,255,0.18);
}
.wv2-claim-avatar-badge {
  position: absolute; right: -6px; bottom: -2px;
  width: 80px; height: 80px; border-radius: 50%;
  background: ${c.deepCharcoal};
  border: 2.2px solid var(--wv2-accent);
  display: flex; align-items: center; justify-content: center;
}
.wv2-claim-badge-camera { width: 40px; height: 32px; color: #fff; }
.wv2-photo-btns { display: flex; flex-direction: column; gap: 12px; width: 277px; max-width: 100%; }
.wv2-photo-btn {
  display: flex; align-items: center; gap: 20px;
  height: 47px; padding-left: 30px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.6); color: #fff;
  font-size: 22px; font-weight: 600; letter-spacing: -0.66px;
  text-align: left; white-space: nowrap;
}
.wv2-photo-btn-ic { width: 22px; height: 24px; flex: none; }
.wv2-photo-note { font-size: 12px; color: #fff; text-align: center; padding-top: 9px; line-height: 1.5; }

/* Step 4: story text area + "Share on Social Media:" glyph row. */
.wv2-step4 { display: flex; flex-direction: column; padding-top: 29px; }
.wv2-story-input {
  width: 100%; height: 215px; padding: 16px 25px; border-radius: 10px;
  background: #212832; border: 1px solid #3d424b;
  font-family: ${V2_INTER}; font-size: 20px; color: #fff; line-height: 1.35;
  outline: none; resize: none; display: block;
}
.wv2-story-input::placeholder { color: rgba(255,255,255,0.6); }
.wv2-story-input:focus { border-color: rgba(255,255,255,0.45); }
.wv2-social { display: flex; flex-direction: column; align-items: center; gap: 15px; padding: 38px 0 17px; }
.wv2-social-title { font-size: 18px; font-weight: 500; letter-spacing: -0.54px; color: #fff; }
.wv2-social-row { display: flex; justify-content: center; gap: clamp(12px, 4vw, 26px); }
.wv2-social-btn { width: 48px; height: 48px; color: #fff; flex: none; }
.wv2-social-glyph { display: block; width: 100%; height: 100%; }

/* Review ("ALMOST DONE!"): the three required consents, inline error, and
   the gunmetal "secure and encrypted" lock note under the CTA. */
.wv2-review { display: flex; flex-direction: column; padding: 44px 12px 12px; }
.wv2-consents { display: flex; flex-direction: column; gap: 32px; }
.wv2-consent-row { display: flex; align-items: flex-start; gap: 12px; text-align: left; }
.wv2-consent-box {
  width: 24px; height: 24px; border-radius: 5px; flex: none;
  background: rgba(255,255,255,0.07);
  border: 1.5px solid rgba(255,255,255,0.4);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.wv2-consent-box svg { opacity: 0; transition: opacity 0.15s ease; }
.wv2-consent-box.wv2-consent-on { background: var(--wv2-accent); border-color: var(--wv2-accent); }
.wv2-consent-box.wv2-consent-on svg { opacity: 1; }
.wv2-consent-text { font-size: 16px; color: #fff; line-height: 1.35; }
.wv2-consent-em { text-decoration: underline; font-weight: 700; }
.wv2-claim-error {
  font-size: 13px; font-weight: 600; color: #ff7366;
  text-align: center; padding: 14px 12px 0;
}
.wv2-review-lock {
  display: flex; align-items: center; gap: 20px;
  margin: 30px 12px 0; padding: 16px 25px;
  border-radius: 10px; background: ${c.gunmetal};
  font-size: 14px; color: #fff; text-align: left;
}
.wv2-review-lock-ic { width: 20px; height: 26px; color: var(--wv2-accent); flex: none; }

/* Confirmation — gold-sparkle backdrop behind the header/title fading into
   the dark body (shorter than the stepped form's), accent-ringed mail
   circle on the "3-5 Business Days" card. */
.wv2-claim-done-bg { height: 250px; }
.wv2-claim-done-title {
  font-size: 26px; font-weight: 900; letter-spacing: -0.7px; color: #fff;
  text-align: center; padding: 20px 30px 0;
}
.wv2-claim-done-sub { font-size: 15px; color: rgba(255,255,255,0.85); text-align: center; padding: 8px 34px 0; }
.wv2-claim-mail-ring {
  width: 54px; height: 54px; border-radius: 50%; flex: none;
  border: 2px solid var(--wv2-accent);
  background: rgba(255,255,255,0.05);
  display: flex; align-items: center; justify-content: center;
}
.wv2-claim-info-card .wv2-claim-mail { width: 28px; height: 22px; color: var(--wv2-accent); flex: none; }
.wv2-claim-mail svg { display: block; width: 100%; height: 100%; }
.wv2-claim-mail-col { display: flex; flex-direction: column; gap: 1px; }
.wv2-claim-mail-line { font-size: 14px; color: #fff; }
.wv2-claim-mail-days { font-size: 18px; font-weight: 900; color: var(--wv2-accent); }

/* The gold OFFICIAL WINNER keepsake card: cream/gold gradient, small trophy
   breaking the top border, serif name, award month + claim number. */
.wv2-gold-card {
  position: relative; margin: 40px 34px 0;
  border-radius: 14px;
  background: linear-gradient(to bottom, #fffaeb, #f2e0ad);
  border: 2px solid #d4ad47;
}
.wv2-gold-trophy {
  position: absolute; top: -27px; left: 50%; transform: translateX(-50%);
  height: 54px; object-fit: contain;
}
.wv2-gold-official {
  display: flex; justify-content: space-between;
  padding: 18px 26px 0;
  font-size: 16px; font-weight: 900; letter-spacing: 0.5px; color: #b88c29;
}
.wv2-gold-name {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 30px; font-weight: 900; color: #1a1712;
  text-align: center; padding: 6px 20px 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wv2-gold-loc { font-size: 14px; color: #737373; text-align: center; margin-top: 4px; }
.wv2-gold-meta {
  font-size: 11px; font-weight: 700; letter-spacing: 1.1px; color: #b88c29;
  text-align: center; padding: 8px 12px 20px;
}
.wv2-claim-done-cta { padding: 30px 30px 34px; }

/* ═══ Loading / empty states ═══ */

.wv2-center-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  padding: 24px; text-align: center;
}
.wv2-empty-title { font-size: 20px; font-weight: 700; color: #fff; }
.wv2-empty-sub { font-size: 14px; color: ${c.textTertiary}; }
.wv2-empty-cta { width: 220px; margin-top: 12px; }

/* Cold-start SKELETON — a pulsing block-out of the real dashboard layout in
   the drawer's own gunmetal, replacing the old spinner + "Loading…".
   ONE shared pulse on the wrapper (not per block) so the whole thing reads as
   a single surface breathing rather than a field of blinking rectangles. */
.wv2-skeleton { overflow: hidden; }
.wv2-sk-pulse {
  display: flex; flex-direction: column; gap: 15px;
  animation: wv2-sk-breathe 900ms ease-in-out infinite alternate;
}
@keyframes wv2-sk-breathe { from { opacity: 0.45; } to { opacity: 0.85; } }
@media (prefers-reduced-motion: reduce) {
  .wv2-sk-pulse { animation: none; opacity: 0.65; }
}
.wv2-sk-block { background: rgba(255,255,255,0.08); border-radius: 6px; flex: none; }
.wv2-sk-header { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
.wv2-sk-circle { width: 36px; height: 36px; border-radius: 50%; }
.wv2-sk-logo { width: 140px; height: 34px; }
.wv2-sk-card { height: 200px; margin: 15px 22px 0; border-radius: 10px; }
.wv2-sk-rail { display: flex; justify-content: space-between; padding: 0 22px; }
.wv2-sk-tile { width: 106px; height: 134px; border-radius: 10px; }
.wv2-sk-bar { height: 71px; border-radius: 0; }
.wv2-sk-pill-wrap { padding: 0 30px; }
.wv2-sk-pill { height: 54px; border-radius: 27px; }
`;
}

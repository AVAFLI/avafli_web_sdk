/**
 * Motion for the V2 experience, ported 1:1 from iOS WINRV2Effects.swift:
 * confetti fields, the draw-on white checkmark, and the pulsing glow on the
 * active streak tile (the glow itself is CSS — see v2-styles.ts).
 * Everything is canvas/SVG so it stays crisp at any scale and respects the
 * publisher accent.
 */

// ─── Confetti ───

export type ConfettiStyle = 'celebration' | 'gold';

/** Multicolor sprinkle from the claim/celebration modals and streak tiles. */
const CELEBRATION_PALETTE = [
  'rgb(245,79,71)',   // red
  'rgb(89,199,107)',  // green
  'rgb(77,158,252)',  // blue
  'rgb(252,204,71)',  // yellow
  'rgb(184,133,245)', // purple
];

/** Winner-modal gold sparkle. */
const GOLD_PALETTE = ['rgb(255,214,89)', 'rgb(240,179,46)', 'rgb(255,237,168)'];

const fract = (v: number): number => v - Math.floor(v);

/**
 * A looping confetti field rendered onto a canvas that fills its parent.
 * Deterministic per-particle parameters (same math as iOS — no Math.random,
 * stable across frames). The rAF loop cancels itself once the canvas leaves
 * the DOM.
 */
export function createConfetti(options: {
  style?: ConfettiStyle;
  count?: number;
  speed?: number;
}): HTMLCanvasElement {
  const { style = 'celebration', count = 42, speed = 1 } = options;
  const canvas = document.createElement('canvas');
  canvas.className = 'wv2-confetti';
  const palette = style === 'celebration' ? CELEBRATION_PALETTE : GOLD_PALETTE;

  let wasConnected = false;
  let rafId = 0;

  const draw = (): void => {
    if (canvas.isConnected) {
      wasConnected = true;
    } else if (wasConnected) {
      cancelAnimationFrame(rafId);
      return;
    }

    const ctx = canvas.getContext('2d');
    // Safety clamp: never let the backing store run away (canvas is a replaced
    // element — if its CSS sizing were ever missing, clientWidth would report
    // its own attribute size back).
    const cssW = Math.min(canvas.clientWidth, 4096);
    const cssH = Math.min(canvas.clientHeight, 4096);
    if (ctx && cssW > 0 && cssH > 0) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pxW = Math.round(cssW * dpr);
      const pxH = Math.round(cssH * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const t = (Date.now() / 1000) * speed;
      for (let i = 0; i < count; i++) {
        const seed = i;
        const fx = fract(seed * 0.61803398875);            // 0..1 x anchor
        const fall = 8.0 + fract(seed * 0.7548776662) * 7.0; // fall period s
        const phase = fract(seed * 0.2928932188);
        const progress = fract(t / fall + phase);          // 0..1 down screen
        const sway = Math.sin(t * 1.7 + seed * 1.3) * 9.0;
        const x = fx * cssW + sway;
        const y = progress * (cssH + 24) - 12;
        const rotation = t * 2.1 + seed;
        const w = 4.0 + fract(seed * 0.833) * 4.0;
        const h = w * (0.55 + fract(seed * 0.377) * 0.5);
        const alpha = style === 'gold' ? 0.55 + fract(seed * 0.51) * 0.45 : 0.9;
        // Flutter: squash on one axis as the piece "tumbles".
        const squash = 0.35 + Math.abs(Math.sin(t * 2.6 + seed * 2.0)) * 0.65;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.scale(1, squash);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = palette[i % palette.length]!;
        roundedRect(ctx, -w / 2, -h / 2, w, h, 1);
        ctx.fill();
        ctx.restore();
      }
    }

    rafId = requestAnimationFrame(draw);
  };

  rafId = requestAnimationFrame(draw);
  return canvas;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// ─── One-shot Figma GIF bursts (Joe's actual reveal animations) ───

/** confetti-burst.gif: 34 frames, 2000ms total, plays once (no loop). */
export const CONFETTI_BURST_DURATION_MS = 2000;

/**
 * Mounts a one-shot GIF overlay (Joe's ACTUAL Figma animation file, embedded
 * as a data URI) and removes it after the GIF's full duration.
 *
 * A FRESH <img> element is created on every call — the browser starts a GIF
 * at frame 0 when the element is (re)created and mounted, so a new element
 * per burst restarts playback reliably (no cache-busting needed for data
 * URIs). The GIF plays once (the file carries no loop extension) and would
 * hold its last frame, so the guarded timeout removes the overlay instead.
 *
 * Teardown guard: if the parent re-rendered or unmounted before the timer
 * fires, the overlay left the document with it — the callback no-ops and
 * never touches removed DOM (same convention as the toast hold timer).
 */
export function mountGifBurst(options: {
  parent: HTMLElement;
  src: string;
  className: string;
  durationMs: number;
  /** Runs after removal, only if the overlay was still mounted (live DOM). */
  onFinished?: () => void;
}): HTMLImageElement {
  const img = document.createElement('img');
  img.className = options.className;
  img.alt = '';
  img.src = options.src;
  options.parent.appendChild(img);
  window.setTimeout(() => {
    if (!img.isConnected) return; // torn down first — never touch removed DOM
    img.remove();
    options.onFinished?.();
  }, options.durationMs);
  return img;
}

// ─── Animated checkmark (draw-on) ───

/**
 * The white circle-check from Joe's modals: the circle sweeps in, then the
 * check strokes on. CSS keyframes drive the dash-offset draw (see
 * v2-styles.ts). The check glyph matches iOS's CheckShape: starts left-center,
 * dips to the low point, kicks up past the circle's top-right edge.
 */
export function createAnimatedCheck(lineWidth: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wv2-animated-check';
  // ViewBox is 100x100; iOS lineWidth is in view points — scale accordingly at
  // typical render sizes (88pt modal / 20pt tile).
  wrap.innerHTML =
    `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;overflow:visible">` +
    `<circle class="wv2-check-circle" cx="50" cy="50" r="${50 - lineWidth / 2}" pathLength="1" ` +
    `stroke="#fff" stroke-width="${lineWidth}" stroke-linecap="round" transform="rotate(-90 50 50)"/>` +
    `<path class="wv2-check-mark" d="M26 54 L45 72 L94 22" pathLength="1" ` +
    `stroke="#fff" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return wrap;
}

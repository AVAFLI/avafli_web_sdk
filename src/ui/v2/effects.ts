/**
 * Motion for the V2 experience, ported 1:1 from iOS WINRV2Effects.swift:
 * confetti fields, the draw-on white checkmark, and the pulsing glow on the
 * active streak tile (the glow itself is CSS — see v2-styles.ts).
 * Everything is canvas/SVG so it stays crisp at any scale and respects the
 * publisher accent.
 */

// ─── Remote image prewarming (publisher prize art + logo) ───

/**
 * Fade-in duration for a remote image that was NOT already warm — short
 * enough to feel instant, long enough to avoid a hard pop. Kept in sync with
 * the `.wv2-img-fade` transition in v2-styles.ts.
 */
export const IMAGE_FADE_MS = 200;

/** URLs already decoded (or in flight) — a repeated refresh is a no-op. */
const warmedImageUrls = new Set<string>();

/**
 * Pulls a remote image into the browser's HTTP/image cache ahead of the
 * drawer opening, so the prize card paints its art on its FIRST frame instead
 * of popping in a beat after everything else.
 *
 * The SDK learns `prizeImageUrl` (and `branding.logoUrl`) at registration /
 * giveaway refresh — long before the experience is presented — which is
 * exactly the moment to pay the download. Fire-and-forget: a failure just
 * means the widget loads it normally, and the URL is dropped from the warmed
 * set so the next refresh can retry.
 *
 * Safe in non-DOM/SSR environments (no `Image` constructor → no-op).
 */
export function prewarmImage(url?: string | null): void {
  if (!url) return;
  if (typeof Image === 'undefined') return; // SSR / non-DOM host
  if (warmedImageUrls.has(url)) return;
  warmedImageUrls.add(url);

  const forget = (): void => {
    warmedImageUrls.delete(url); // allow a retry on the next refresh
  };

  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    // decode() resolves once the bytes are downloaded AND decoded, which is
    // what actually makes the later <img> paint synchronously. Not every
    // engine implements it — a plain load/error pair is the fallback.
    if (typeof img.decode === 'function') {
      void img.decode().catch(forget);
    } else {
      img.onerror = forget;
    }
  } catch {
    forget();
  }
}

/** @internal — whether {@link prewarmImage} has already warmed this URL. */
export function isImageWarmed(url: string): boolean {
  return warmedImageUrls.has(url);
}

/** @internal — test hook; clears the warmed-URL set. */
export function resetImageWarmer(): void {
  warmedImageUrls.clear();
}

// ─── Confetti ───

/**
 * Whether the user asked the OS for reduced motion. SSR-safe (no matchMedia
 * → false). Checked once per effect mount — the OS setting flipping mid-
 * animation re-applies on the next render, which is plenty.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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
 *
 * Respects prefers-reduced-motion (2.9.4): under `reduce`, the field draws
 * ONE static frame (the decorative specks stay, nothing tumbles) and the
 * loop stops.
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
  const reduced = prefersReducedMotion();

  let wasConnected = false;
  let drewFrame = false;
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
      drewFrame = true;
    }

    // Reduced motion: stop after the first REAL frame (keep looping until
    // layout gives the canvas a size, so the static frame actually exists).
    if (reduced && drewFrame) return;
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

// ─── One-shot confetti BURST (canvas) ───

/**
 * The reveal-beat explosion, drawn on a canvas instead of the embedded GIF.
 *
 * WebKit does not auto-play animated images when the OS asks for reduced
 * motion (and may defer decoding a freshly mounted GIF), which left the web
 * streak tile with NO explosion while every native SDK — which decodes the
 * same GIF frame-by-frame itself — always showed one. The canvas replays the
 * GIF's choreography: ~45 pieces racing out from the centre to about 55% of
 * the canvas, tumbling, then fading over the last third (2000ms, one shot).
 * Under reduced motion a single mid-burst scatter is held instead, so the
 * moment is still marked without motion.
 *
 * Same lifecycle contract as mountGifBurst: a guarded timeout removes the
 * canvas after `durationMs`, and onFinished runs only if it was still
 * mounted (a torn-down parent takes the canvas with it — never touch
 * removed DOM).
 */
export function mountCanvasBurst(options: {
  parent: HTMLElement;
  className: string;
  durationMs?: number;
  count?: number;
  onFinished?: () => void;
}): HTMLCanvasElement {
  const { parent, className, durationMs = CONFETTI_BURST_DURATION_MS, count = 46 } = options;
  const canvas = document.createElement('canvas');
  canvas.className = className;
  const reduced = prefersReducedMotion();
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let rafId = 0;

  const drawAt = (p: number): void => {
    const ctx = canvas.getContext('2d');
    const cssW = Math.min(canvas.clientWidth, 4096);
    const cssH = Math.min(canvas.clientHeight, 4096);
    if (!ctx || cssW <= 0 || cssH <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const cx = cssW / 2;
    const cy = cssH / 2;
    const reach = Math.min(cssW, cssH) * 0.55;
    // Radial ease-out: fast launch, gentle settle (the GIF's ring expansion).
    const travel = 1 - Math.pow(1 - p, 2.2);
    // Fade: full until 60%, gone by 100%; a quick fade-in over the first ~12%.
    const fade = Math.min(1, p * 8) * (p < 0.6 ? 1 : Math.max(0, 1 - (p - 0.6) / 0.4));

    for (let i = 0; i < count; i++) {
      const seed = i;
      const angle = fract(seed * 0.61803398875) * Math.PI * 2;
      const vigor = 0.55 + fract(seed * 0.7548776662) * 0.45; // per-piece reach
      const r = reach * vigor * travel;
      const drop = p * p * reach * 0.35 * (0.6 + fract(seed * 0.51) * 0.8); // gravity
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r + drop;
      const spin = (fract(seed * 0.2928932188) - 0.5) * 12;
      const rotation = seed + p * spin;
      const w = 4.0 + fract(seed * 0.833) * 3.0;
      const h = w * (0.55 + fract(seed * 0.377) * 0.5);
      const squash = 0.35 + Math.abs(Math.sin(p * 9 + seed * 2.0)) * 0.65;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.scale(1, squash);
      ctx.globalAlpha = 0.95 * fade;
      ctx.fillStyle = CELEBRATION_PALETTE[i % CELEBRATION_PALETTE.length]!;
      roundedRect(ctx, -w / 2, -h / 2, w, h, 1);
      ctx.fill();
      ctx.restore();
    }
  };

  const frame = (): void => {
    if (!canvas.isConnected) return; // parent torn down — stop drawing
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const p = Math.min(1, (now - start) / durationMs);
    drawAt(reduced ? 0.45 : p);
    if (reduced || p >= 1) return;
    rafId = requestAnimationFrame(frame);
  };

  parent.appendChild(canvas);
  rafId = requestAnimationFrame(frame);

  window.setTimeout(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (!canvas.isConnected) return; // torn down first — never touch removed DOM
    canvas.remove();
    options.onFinished?.();
  }, durationMs);
  return canvas;
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

// ─── Two-line shrink-to-fit (iOS minimumScaleFactor parity) ───

/**
 * Pure size picker: given a measurer that reports how many lines `text`
 * needs at a font size, returns the largest size ≥ base×minScale that fits
 * `maxLines`, stepping down ~4% at a time (SwiftUI's lineLimit +
 * minimumScaleFactor). Falls back to the floor when nothing fits.
 */
export function pickFittingFontSize(
  base: number,
  minScale: number,
  maxLines: number,
  linesAt: (px: number) => number,
): number {
  const floor = base * minScale;
  let size = base;
  while (size > floor) {
    if (linesAt(size) <= maxLines) return size;
    size = Math.max(floor, size * 0.96);
    if (size === floor) break;
  }
  return floor;
}

/**
 * Shrinks an element's font-size until its text fits `maxLines` (measured
 * from its own line-height), never below `minScale`. Runs after layout and
 * again on resize; a no-op for text that already fits.
 */
export function fitTextToLines(el: HTMLElement, maxLines = 2, minScale = 0.55): void {
  const apply = (): void => {
    if (!el.isConnected) return;
    el.style.fontSize = '';
    const cs = getComputedStyle(el);
    const base = parseFloat(cs.fontSize) || 28;
    const ratio = (parseFloat(cs.lineHeight) || base * 1.05) / base;
    const linesAt = (px: number): number => {
      el.style.fontSize = `${px}px`;
      return Math.round(el.scrollHeight / (px * ratio));
    };
    el.style.fontSize = `${pickFittingFontSize(base, minScale, maxLines, linesAt)}px`;
  };
  requestAnimationFrame(apply);
  window.addEventListener('resize', apply, { passive: true });
}

/**
 * On-screen keyboard avoidance for the V2 drawer (mobile Safari especially).
 *
 * iOS Safari (and Chrome ≥108 on Android, `interactive-widget=resizes-visual`)
 * does NOT shrink the LAYOUT viewport when the software keyboard opens — only
 * `window.visualViewport` shrinks. The drawer is a fixed, 90dvh bottom sheet,
 * so without help the keyboard simply covers its lower half: the focused
 * field can sit underneath it, and everything below the field (VERIFY,
 * "Send a new code", legal footers) becomes unreachable.
 *
 * This module implements the guarantee in three parts:
 *  1. The keyboard's overlap with the layout viewport is published as the
 *     `--wv2-kb` CSS custom property on the overlay; every screen's scroll
 *     container adds it as bottom padding (see v2-styles.ts), so ALL content
 *     stays scroll-reachable while the keyboard is up.
 *  2. On focusin — and again on every visualViewport resize while a field
 *     stays focused (the keyboard animates in AFTER focus) — the focused
 *     field is scrolled visible inside its own scroll container, above the
 *     keyboard, with breathing room. An open Places suggestions dropdown is
 *     included in the visibility target so it never hides under the keyboard.
 *  3. On blur/keyboard-dismiss the next visualViewport resize zeroes the
 *     padding again — no stale insets, no blank gap. detach() removes every
 *     listener (called from the experience's dismiss()).
 *
 * The math is exported pure for unit tests.
 */

/** Breathing room kept between the focused field and the keyboard/container edges. */
export const KEYBOARD_FIELD_CLEARANCE_PX = 16;

/** Keyboard-settle delay: focus fires before the keyboard finishes animating. */
export const KEYBOARD_SETTLE_MS = 250;

/**
 * How many CSS px of the layout viewport's bottom the keyboard covers.
 * `layoutHeight` is window.innerHeight; `vvHeight`/`vvOffsetTop` come from
 * window.visualViewport. Clamped to ≥ 0 (desktop, keyboard closed, or the
 * visual viewport panned past the layout bottom).
 */
export function keyboardOverlapPx(
  layoutHeight: number,
  vvHeight: number,
  vvOffsetTop: number
): number {
  return Math.max(0, Math.round(layoutHeight - vvHeight - vvOffsetTop));
}

/**
 * Scroll delta (positive = scroll down) that brings [targetTop, targetBottom]
 * into [visibleTop, visibleBottom] with `clearance` on both sides. Bottom
 * first, then the top is re-clamped so it always wins for targets taller
 * than the visible band (the field's top edge — where the caret usually is —
 * must never be pushed out of view). 0 when already fully visible.
 */
export function ensureVisibleDelta(
  targetTop: number,
  targetBottom: number,
  visibleTop: number,
  visibleBottom: number,
  clearance: number = KEYBOARD_FIELD_CLEARANCE_PX
): number {
  let delta = 0;
  if (targetBottom > visibleBottom - clearance) {
    delta = targetBottom - (visibleBottom - clearance);
  }
  if (targetTop - delta < visibleTop + clearance) {
    delta = targetTop - (visibleTop + clearance);
  }
  return Math.round(delta);
}

/** True for elements whose focus summons a keyboard worth avoiding. */
export function isKeyboardTarget(target: unknown): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'file';
}

/** The screen-level scroll containers a focused field may live in. */
const SCROLL_CONTAINER_SELECTOR = '.wv2-scroll, .wv2-claim-page';

export interface KeyboardAvoidanceHandle {
  detach(): void;
}

/**
 * Installs keyboard avoidance on the experience overlay (inside the shadow
 * root — focusin/focusout are composed, so they cross the boundary fine).
 * Returns a handle whose detach() removes every listener and clears the
 * inset; the experience calls it on dismiss.
 */
export function attachKeyboardAvoidance(overlay: HTMLElement): KeyboardAvoidanceHandle {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  let focused: HTMLElement | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Bottom of the visible (un-occluded) viewport in client coordinates. */
  const visibleViewportBottom = (): number =>
    vv ? vv.offsetTop + vv.height : window.innerHeight;

  const syncInset = (): void => {
    const overlap = vv
      ? keyboardOverlapPx(window.innerHeight, vv.height, vv.offsetTop)
      : 0;
    overlay.style.setProperty('--wv2-kb', `${overlap}px`);
  };

  /**
   * The field to keep visible: the focusin-tracked element, else the shadow
   * root's activeElement (focusin is not delivered for programmatic focus in
   * an unfocused document, and re-deriving from activeElement makes the
   * viewport-resize path self-sufficient either way).
   */
  const activeField = (): HTMLElement | null => {
    if (focused && focused.isConnected) return focused;
    const root = overlay.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement;
    return isKeyboardTarget(active) && overlay.contains(active) ? active : null;
  };

  const ensureFocusedVisible = (): void => {
    const field = activeField();
    if (!field) return;
    const container = field.closest<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
    if (!container) return;

    // Target the whole field block (label + input + inline error) when there
    // is one, and extend it to cover an OPEN Places suggestions dropdown so
    // the list is scrolled clear of the keyboard along with its field.
    const block = field.closest<HTMLElement>('.wv2-sf') ?? field;
    const rect = block.getBoundingClientRect();
    let targetTop = rect.top;
    let targetBottom = rect.bottom;
    const dropdown = block.querySelector<HTMLElement>('.wv2-places-dd');
    if (dropdown && dropdown.style.display !== 'none') {
      const dd = dropdown.getBoundingClientRect();
      targetBottom = Math.max(targetBottom, dd.bottom);
    }

    const containerRect = container.getBoundingClientRect();
    const visibleTop = Math.max(containerRect.top, 0);
    const visibleBottom = Math.min(containerRect.bottom, visibleViewportBottom());
    if (visibleBottom <= visibleTop) return;

    const delta = ensureVisibleDelta(targetTop, targetBottom, visibleTop, visibleBottom);
    if (delta !== 0) {
      // Instant, not behavior:'smooth' — smooth scrolling is animation-frame
      // driven and silently never completes in throttled/background tabs,
      // and it fights the keyboard's own animation on iOS. The keyboard
      // opening already masks the jump.
      container.scrollTop += delta;
    }
  };

  const scheduleEnsure = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      ensureFocusedVisible();
    }, KEYBOARD_SETTLE_MS);
  };

  const onFocusIn = (e: Event): void => {
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    if (!isKeyboardTarget(target)) return;
    focused = target;
    // Immediate best-effort (desktop / keyboard already up), then again once
    // the keyboard has settled and the insets are known.
    ensureFocusedVisible();
    scheduleEnsure();
  };

  const onFocusOut = (): void => {
    focused = null;
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  // While typing, the Places dropdown appears/grows below the street field —
  // re-check visibility so the list never renders under the keyboard.
  const onInput = (): void => {
    if (activeField()) scheduleEnsure();
  };

  const onViewportChange = (): void => {
    syncInset();
    // The keyboard animates in after focus — follow it while a field is
    // focused so the field lands above the final keyboard height.
    ensureFocusedVisible();
  };

  overlay.addEventListener('focusin', onFocusIn);
  overlay.addEventListener('focusout', onFocusOut);
  overlay.addEventListener('input', onInput);
  vv?.addEventListener('resize', onViewportChange);
  vv?.addEventListener('scroll', onViewportChange);
  window.addEventListener('resize', syncInset);
  syncInset();

  return {
    detach(): void {
      overlay.removeEventListener('focusin', onFocusIn);
      overlay.removeEventListener('focusout', onFocusOut);
      overlay.removeEventListener('input', onInput);
      vv?.removeEventListener('resize', onViewportChange);
      vv?.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', syncInset);
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      focused = null;
      overlay.style.removeProperty('--wv2-kb');
    },
  };
}

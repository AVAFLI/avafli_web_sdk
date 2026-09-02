// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_FIELD_CLEARANCE_PX,
  attachKeyboardAvoidance,
  ensureVisibleDelta,
  isKeyboardTarget,
  keyboardOverlapPx,
} from '../src/ui/v2/keyboard';

describe('keyboardOverlapPx', () => {
  it('is zero when the visual viewport fills the layout viewport (keyboard closed)', () => {
    expect(keyboardOverlapPx(844, 844, 0)).toBe(0);
  });

  it('equals the shrink when the keyboard opens without panning', () => {
    // iPhone-ish: 844pt layout, keyboard eats 336.
    expect(keyboardOverlapPx(844, 508, 0)).toBe(336);
  });

  it('subtracts the visual-viewport pan (iOS Safari scrolls the page up)', () => {
    // Safari panned the visual viewport down 100px to reveal the field.
    expect(keyboardOverlapPx(844, 508, 100)).toBe(236);
  });

  it('never goes negative (over-panned or desktop zoom quirks)', () => {
    expect(keyboardOverlapPx(844, 800, 100)).toBe(0);
  });

  it('rounds to whole pixels', () => {
    expect(keyboardOverlapPx(844, 508.4, 0)).toBe(336);
  });
});

describe('ensureVisibleDelta', () => {
  const CL = KEYBOARD_FIELD_CLEARANCE_PX;

  it('is zero when the target is already fully visible with clearance', () => {
    expect(ensureVisibleDelta(100 + CL, 200, 100, 500)).toBe(0);
  });

  it('scrolls down just enough when the target sits under the keyboard', () => {
    // Visible band ends at 400 (keyboard bottom); field bottom at 520.
    expect(ensureVisibleDelta(460, 520, 100, 400)).toBe(520 - (400 - CL));
  });

  it('scrolls up (negative) when the target is above the visible band', () => {
    expect(ensureVisibleDelta(40, 90, 100, 400)).toBe(40 - (100 + CL));
  });

  it('keeps the top edge visible for targets taller than the band', () => {
    // Field + open autocomplete dropdown taller than the visible band: the
    // top (caret) wins — delta lands the top at visibleTop + clearance.
    const delta = ensureVisibleDelta(300, 900, 100, 400);
    expect(300 - delta).toBe(100 + CL);
  });
});

describe('isKeyboardTarget', () => {
  it('accepts text inputs and textareas', () => {
    const input = document.createElement('input');
    input.type = 'email';
    expect(isKeyboardTarget(input)).toBe(true);
    expect(isKeyboardTarget(document.createElement('textarea'))).toBe(true);
  });

  it('rejects checkboxes, file inputs, buttons and non-elements', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(isKeyboardTarget(box)).toBe(false);
    const file = document.createElement('input');
    file.type = 'file';
    expect(isKeyboardTarget(file)).toBe(false);
    expect(isKeyboardTarget(document.createElement('button'))).toBe(false);
    expect(isKeyboardTarget(null)).toBe(false);
  });
});

describe('attachKeyboardAvoidance', () => {
  it('publishes a zero inset on attach and clears the property on detach', () => {
    const overlay = document.createElement('div');
    document.body.appendChild(overlay);
    const handle = attachKeyboardAvoidance(overlay);
    // jsdom has no visualViewport → the inset must still be defined (0px),
    // never left unset while attached.
    expect(overlay.style.getPropertyValue('--wv2-kb')).toBe('0px');
    handle.detach();
    expect(overlay.style.getPropertyValue('--wv2-kb')).toBe('');
    overlay.remove();
  });

  it('detach is idempotent and safe after the overlay left the DOM', () => {
    const overlay = document.createElement('div');
    const handle = attachKeyboardAvoidance(overlay);
    handle.detach();
    expect(() => handle.detach()).not.toThrow();
  });

  it('window resize keeps the inset in sync while attached, not after detach', () => {
    const overlay = document.createElement('div');
    document.body.appendChild(overlay);
    const handle = attachKeyboardAvoidance(overlay);
    overlay.style.setProperty('--wv2-kb', '123px'); // simulate a stale value
    window.dispatchEvent(new Event('resize'));
    expect(overlay.style.getPropertyValue('--wv2-kb')).toBe('0px');
    handle.detach();
    window.dispatchEvent(new Event('resize'));
    expect(overlay.style.getPropertyValue('--wv2-kb')).toBe('');
    overlay.remove();
  });
});

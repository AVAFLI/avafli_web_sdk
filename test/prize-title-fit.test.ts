import { describe, it, expect } from 'vitest';
import { pickFittingFontSize } from '../src/ui/v2/effects';

/** iOS parity: shrink a long physical-prize name to fit two lines, floor 55%. */
describe('pickFittingFontSize', () => {
  it('keeps the base size when the text already fits', () => {
    expect(pickFittingFontSize(28, 0.55, 2, () => 2)).toBe(28);
  });
  it('steps down until two lines fit, never below the floor', () => {
    // Needs 3 lines above 22px, 2 lines at or below.
    const size = pickFittingFontSize(28, 0.55, 2, (px) => (px > 22 ? 3 : 2));
    expect(size).toBeLessThanOrEqual(22);
    expect(size).toBeGreaterThan(21);
  });
  it('falls back to the floor when nothing fits (ellipsis territory)', () => {
    expect(pickFittingFontSize(28, 0.55, 2, () => 5)).toBeCloseTo(28 * 0.55, 5);
  });
});

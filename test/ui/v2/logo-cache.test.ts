// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { logoNode, preloadLogo, _resetLogoCache } from '../../../src/ui/v2/logo-cache';

describe('logo-cache', () => {
  beforeEach(() => _resetLogoCache());

  it('returns the SAME node for the same url + slot across renders', () => {
    const a = logoNode('https://x/logo.png', 'sheet');
    const b = logoNode('https://x/logo.png', 'sheet');
    expect(a).toBe(b);
    expect(a.src).toBe('https://x/logo.png');
    expect(a.decoding).toBe('sync');
  });

  it('keeps separate nodes per slot so sheet and claim headers can coexist', () => {
    expect(logoNode('https://x/logo.png', 'sheet')).not.toBe(logoNode('https://x/logo.png', 'claim'));
  });

  it('preloadLogo creates both slots and tolerates decode failures', async () => {
    (HTMLImageElement.prototype as any).decode = () => Promise.reject(new Error('nope'));
    preloadLogo('https://x/logo.png');
    await Promise.resolve();
    expect(logoNode('https://x/logo.png', 'sheet').src).toBe('https://x/logo.png');
    expect(logoNode('https://x/logo.png', 'claim').src).toBe('https://x/logo.png');
    expect(() => preloadLogo(null)).not.toThrow();
  });
});

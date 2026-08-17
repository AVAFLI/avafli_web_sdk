// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { taggedShareUrl } from '../src/ui/v2/screens';

/**
 * Share-link UTM tagging: whenever the publisher's shareUrl rides along in a
 * share action it gains `utm_source={network}&utm_medium=winr_share` — unless
 * the publisher already tagged it with their own utm_source.
 */
describe('share-link UTM tagging', () => {
  it('appends utm params to a plain URL', () => {
    expect(taggedShareUrl('https://example.com/app', 'x')).toBe(
      'https://example.com/app?utm_source=x&utm_medium=winr_share'
    );
  });

  it('appends utm params to a URL with an existing query string', () => {
    expect(taggedShareUrl('https://example.com/app?ref=abc', 'facebook')).toBe(
      'https://example.com/app?ref=abc&utm_source=facebook&utm_medium=winr_share'
    );
  });

  it('leaves a URL with an existing utm_source untouched', () => {
    const url = 'https://example.com/app?utm_source=publisher&utm_medium=email';
    expect(taggedShareUrl(url, 'x')).toBe(url);
  });

  it('passes through null, undefined, empty, and unparseable URLs', () => {
    expect(taggedShareUrl(null, 'x')).toBeNull();
    expect(taggedShareUrl(undefined, 'x')).toBeUndefined();
    expect(taggedShareUrl('', 'x')).toBe('');
    expect(taggedShareUrl('not a url', 'x')).toBe('not a url');
  });

  it('each network carries its own utm_source value', () => {
    for (const network of ['x', 'facebook', 'instagram', 'snapchat', 'tiktok']) {
      const tagged = taggedShareUrl('https://example.com/app', network);
      const params = new URL(tagged as string).searchParams;
      expect(params.get('utm_source')).toBe(network);
      expect(params.get('utm_medium')).toBe('winr_share');
    }
  });
});

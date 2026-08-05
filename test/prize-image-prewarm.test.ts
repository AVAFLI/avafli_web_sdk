// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isImageWarmed, prewarmImage, resetImageWarmer } from '../src/ui/v2/effects';
import { renderPrizeHero } from '../src/ui/v2/screens';
import { V2_IMAGES } from '../src/ui/v2/assets.generated';

/**
 * Remote-image prewarming (2.3.3).
 *
 * The publisher's prize art and logo used to be fetched lazily by the <img>
 * that displays them, so they visibly popped in a beat after the card. They
 * are now decoded as soon as the SDK learns the giveaway config (registration
 * + every refresh + experience mount), which normally means the card paints
 * its art on the first frame. The display site keeps the late path graceful:
 * a dark placeholder, a ~200ms fade, and a bundled fallback on error.
 */

const URL_A = 'https://cdn.example.com/prize-a.png';
const URL_B = 'https://cdn.example.com/prize-b.png';

/** Stand-in for the browser's Image, with a test-controlled decode(). */
class FakeImage {
  static instances: FakeImage[] = [];
  /** When false, instances expose no decode() (the load/error fallback). */
  static supportsDecode = true;

  public src = '';
  public decoding = 'auto';
  public onerror: (() => void) | null = null;
  private resolveDecode!: () => void;
  private rejectDecode!: (error: unknown) => void;
  private readonly decoded: Promise<void>;

  constructor() {
    FakeImage.instances.push(this);
    this.decoded = new Promise<void>((resolve, reject) => {
      this.resolveDecode = resolve;
      this.rejectDecode = reject;
    });
    // Swallow the rejection here; prewarmImage attaches its own handler.
    this.decoded.catch(() => {});
    if (!FakeImage.supportsDecode) {
      (this as { decode?: () => Promise<void> }).decode = undefined;
    }
  }

  public decode(): Promise<void> {
    return this.decoded;
  }

  public succeed(): void {
    this.resolveDecode();
  }

  public fail(): void {
    this.rejectDecode(new Error('404'));
  }
}

function installFakeImage(): void {
  FakeImage.instances = [];
  (globalThis as { Image?: unknown }).Image = FakeImage;
}

describe('prewarmImage', () => {
  const realImage = (globalThis as { Image?: unknown }).Image;

  beforeEach(() => {
    resetImageWarmer();
    FakeImage.supportsDecode = true;
    installFakeImage();
  });

  afterEach(() => {
    (globalThis as { Image?: unknown }).Image = realImage;
    resetImageWarmer();
  });

  it('warms a URL once — a repeat refresh is a no-op', () => {
    prewarmImage(URL_A);
    expect(FakeImage.instances).toHaveLength(1);
    expect(FakeImage.instances[0]?.src).toBe(URL_A);
    expect(isImageWarmed(URL_A)).toBe(true);

    // Every giveaway refresh calls this again; only new URLs cost anything.
    prewarmImage(URL_A);
    prewarmImage(URL_A);
    expect(FakeImage.instances).toHaveLength(1);

    prewarmImage(URL_B);
    expect(FakeImage.instances).toHaveLength(2);
  });

  it('ignores empty/absent URLs (an unconfigured prize image or logo)', () => {
    prewarmImage(undefined);
    prewarmImage(null);
    prewarmImage('');
    expect(FakeImage.instances).toHaveLength(0);
  });

  it('stays warm after a successful decode', async () => {
    prewarmImage(URL_A);
    FakeImage.instances[0]?.succeed();
    await Promise.resolve();

    expect(isImageWarmed(URL_A)).toBe(true);
    prewarmImage(URL_A);
    expect(FakeImage.instances).toHaveLength(1);
  });

  it('drops a FAILED URL so the next refresh retries it', async () => {
    prewarmImage(URL_A);
    expect(isImageWarmed(URL_A)).toBe(true);

    FakeImage.instances[0]?.fail();
    await Promise.resolve();
    await Promise.resolve();

    expect(isImageWarmed(URL_A)).toBe(false);
    prewarmImage(URL_A);
    expect(FakeImage.instances).toHaveLength(2);
  });

  it('falls back to onerror when the engine has no decode()', () => {
    FakeImage.supportsDecode = false;
    prewarmImage(URL_A);

    const img = FakeImage.instances[0];
    expect(img?.onerror).toBeTypeOf('function');
    img?.onerror?.();
    expect(isImageWarmed(URL_A)).toBe(false);
  });

  it('is a safe no-op when Image is undefined (SSR / non-DOM host)', () => {
    delete (globalThis as { Image?: unknown }).Image;

    expect(() => prewarmImage(URL_A)).not.toThrow();
    // Nothing was attempted, so nothing is recorded as warmed — a later
    // browser-side call still gets its chance.
    expect(isImageWarmed(URL_A)).toBe(false);
  });

  it('survives an Image constructor that throws', () => {
    (globalThis as { Image?: unknown }).Image = function ThrowingImage(): never {
      throw new Error('blocked');
    };

    expect(() => prewarmImage(URL_A)).not.toThrow();
    expect(isImageWarmed(URL_A)).toBe(false);
  });
});

describe('prize hero display', () => {
  it('uses the bundled cash hero, unfaded, when no prize image is configured', () => {
    const hero = renderPrizeHero(undefined);
    expect(hero.getAttribute('src')).toBe(V2_IMAGES.cashHero);
    expect(hero.classList.contains('wv2-img-fade')).toBe(false);
  });

  it('fades a COLD remote image in when its bytes arrive late', () => {
    const hero = renderPrizeHero(URL_A);
    expect(hero.getAttribute('src')).toBe(URL_A);
    // Not yet decoded: starts transparent over the card's dark background.
    expect(hero.classList.contains('wv2-img-fade')).toBe(true);
    expect(hero.classList.contains('wv2-img-ready')).toBe(false);

    hero.dispatchEvent(new Event('load'));
    expect(hero.classList.contains('wv2-img-ready')).toBe(true);
  });

  it('does NOT fade an already-warm image — it paints with the card', () => {
    // A prewarmed URL resolves synchronously on assignment: complete, with
    // real intrinsic dimensions. (happy-dom never loads bytes, so both are
    // stubbed to model the warm browser case.)
    const proto = (globalThis as unknown as { HTMLImageElement: { prototype: object } })
      .HTMLImageElement.prototype;
    const originals = {
      complete: Object.getOwnPropertyDescriptor(proto, 'complete'),
      naturalWidth: Object.getOwnPropertyDescriptor(proto, 'naturalWidth'),
    };
    Object.defineProperty(proto, 'complete', { get: () => true, configurable: true });
    Object.defineProperty(proto, 'naturalWidth', { get: () => 1200, configurable: true });
    try {
      const hero = renderPrizeHero(URL_A);
      expect(hero.classList.contains('wv2-img-fade')).toBe(false);
      expect(hero.classList.contains('wv2-img-ready')).toBe(false);
    } finally {
      if (originals.complete) Object.defineProperty(proto, 'complete', originals.complete);
      if (originals.naturalWidth) {
        Object.defineProperty(proto, 'naturalWidth', originals.naturalWidth);
      }
    }
  });

  it('falls back to the bundled cash hero on a broken publisher URL', () => {
    const hero = renderPrizeHero(URL_A);
    hero.dispatchEvent(new Event('error'));

    expect(hero.getAttribute('src')).toBe(V2_IMAGES.cashHero);
    expect(hero.classList.contains('wv2-img-fade')).toBe(false);
    expect(hero.classList.contains('wv2-img-ready')).toBe(false);
  });
});

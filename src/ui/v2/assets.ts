/**
 * Runtime view over the generated asset manifest (assets.generated.ts):
 * resolves each file against the configured asset base (src/assets.ts) and
 * applies images to <img> elements with a reserved box and a placeholder.
 */
import { assetUrl } from '../../assets';
import { V2_FONT_FILES, V2_IMAGE_FILES, V2ImageFile, V2ImageKey } from './assets.generated';

export type { V2ImageKey } from './assets.generated';

/** Manifest entry for an image key. */
export function imageAsset(key: V2ImageKey): V2ImageFile {
  return V2_IMAGE_FILES[key];
}

/** Absolute URL of an image under the current asset base. */
export function imageUrl(key: V2ImageKey): string {
  return assetUrl(V2_IMAGE_FILES[key].file);
}

/**
 * Image URLs keyed like the pre-3.2.1 inline map (`V2_IMAGES.cashHero`, …).
 * Each key is a getter, so a base set in configure() is honoured even if this
 * module was evaluated earlier.
 */
export const V2_IMAGES: Readonly<Record<V2ImageKey, string>> = Object.freeze(
  Object.defineProperties(
    {},
    Object.fromEntries(
      (Object.keys(V2_IMAGE_FILES) as V2ImageKey[]).map((key) => [
        key,
        { get: () => imageUrl(key), enumerable: true },
      ])
    ) as PropertyDescriptorMap
  ) as Record<V2ImageKey, string>
);

/**
 * Points an <img> at a bundled asset: reserves its intrinsic box (width/height
 * attributes — CSS still wins where it sets a size, and the attributes give
 * the aspect ratio where it does not, so nothing shifts when the bytes land),
 * paints the manifest's solid-colour placeholder behind it until then, and
 * sets the src. Transparent art has no placeholder — nothing is painted.
 */
export function assetImage(img: HTMLImageElement, key: V2ImageKey): HTMLImageElement {
  const asset = V2_IMAGE_FILES[key];
  img.width = asset.width;
  img.height = asset.height;
  if (asset.placeholder) {
    img.style.backgroundImage = `url("${asset.placeholder}")`;
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';
    img.style.backgroundRepeat = 'no-repeat';
  }
  img.decoding = 'async';
  img.src = imageUrl(key);
  return img;
}

/** Font faces with their URLs resolved against the current base. */
export function fontFaces(): { family: string; weight: number; url: string }[] {
  return V2_FONT_FILES.map((f) => ({ family: f.family, weight: f.weight, url: assetUrl(f.file) }));
}

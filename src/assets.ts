/**
 * Where the experience's fonts and imagery are fetched from (3.2.1).
 *
 * The SDK bundles no longer embed the V2 assets; they reference content-hashed
 * files under {@link ASSET_BASE}, served immutable (one year) with CORS from
 * Avafli's CDN. A publisher who self-hosts the files (copy
 * avafli-website/public/sdk-assets/v2/ as-is — the hashed names are part of
 * the manifest) points the SDK at them with `assetBaseUrl` on
 * `Avafli.configure()`.
 *
 * This module is part of the boot chunk and must not import anything under
 * src/ui — the UI chunk reads the base through {@link getAssetBaseUrl}.
 */

/** Default asset host — the SDK's own CDN path. */
export const ASSET_BASE = 'https://sdk.avafli.com/sdk-assets/v2';

let assetBase = ASSET_BASE;

/**
 * Normalises a publisher-supplied base: trims whitespace and trailing
 * slashes; empty/blank falls back to {@link ASSET_BASE}. Relative paths
 * (`/vendor/avafli`) are accepted as-is for same-origin self-hosting.
 */
export function normalizeAssetBaseUrl(url?: string | null): string {
  const trimmed = (url ?? '').trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : ASSET_BASE;
}

/** Sets the base used by every later asset URL. Called from configure(). */
export function setAssetBaseUrl(url?: string | null): void {
  assetBase = normalizeAssetBaseUrl(url);
}

/** The base currently in effect. */
export function getAssetBaseUrl(): string {
  return assetBase;
}

/** `<base>/<file>` for a manifest file name. */
export function assetUrl(file: string): string {
  return `${assetBase}/${file}`;
}

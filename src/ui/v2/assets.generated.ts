/**
 * GENERATED FILE — do not edit by hand.
 * Run `node scripts/generate-assets.mjs` to regenerate from /assets.
 *
 * Manifest of the V2 experience's fonts and imagery. Since 3.2.1 the files
 * themselves are NOT embedded: they are served as content-hashed, immutable
 * files from the asset host (see src/assets.ts — `ASSET_BASE`, overridable
 * with `assetBaseUrl`). Each entry is a file name relative to that base.
 */

export interface V2FontFile {
  family: string;
  weight: number;
  /** WOFF2 file name under the asset base — pair with format('woff2') in the @font-face src. */
  file: string;
}

export interface V2ImageFile {
  /** File name under the asset base. */
  file: string;
  /** Intrinsic pixel size — set on the <img> so its box is reserved before the bytes land. */
  width: number;
  height: number;
  /**
   * Solid colour painted behind the image until it loads (an inline SVG data
   * URI). null when the art is transparent — nothing is painted, the box is
   * still reserved.
   */
  placeholder: string | null;
}

export const V2_FONT_FILES: V2FontFile[] = [
  { family: 'Avafli Inter', weight: 400, file: 'inter-400.8909904a.woff2' },
  { family: 'Avafli Inter', weight: 500, file: 'inter-500.f3779f1e.woff2' },
  { family: 'Avafli Inter', weight: 600, file: 'inter-600.f9a06e79.woff2' },
  { family: 'Avafli Inter', weight: 700, file: 'inter-700.6f56409f.woff2' },
  { family: 'Avafli Inter', weight: 800, file: 'inter-800.a7d0a50f.woff2' },
  { family: 'Avafli Inter', weight: 900, file: 'inter-900.d5c0ed7b.woff2' },
  { family: 'Avafli Oswald', weight: 500, file: 'oswald-500.990b30d4.woff2' },
  { family: 'Avafli Oswald', weight: 700, file: 'oswald-700.aae665c7.woff2' },
];

export const V2_IMAGE_FILES = {
  /** Default prize hero (money pile) — used when the publisher has not set a prize image. */
  cashHero: { file: 'cash-hero.1446e0a3.jpg', width: 701, height: 561, placeholder: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22701%22%20height%3D%22561%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23ffffff%22%2F%3E%3C%2Fsvg%3E' },
  /** Gold-sparkle art behind the winner dialog. */
  winnerModalBg: { file: 'winner-modal-bg.44d6ca91.jpg', width: 800, height: 533, placeholder: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22800%22%20height%3D%22533%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%232a1706%22%2F%3E%3C%2Fsvg%3E' },
  /** Trophy (winner banner + dialog). */
  trophy: { file: 'trophy.4e0b22bb.png', width: 320, height: 290, placeholder: null },
  /** Static white circle-check for COMPLETED streak tiles. */
  checkCompleted: { file: 'check-tile-completed.1f0bef2f.png', width: 64, height: 64, placeholder: null },
  /** Joe's Figma confetti burst (34 frames / 2000ms, plays once). */
  confettiBurst: { file: 'confetti-burst.92ad367c.gif', width: 498, height: 500, placeholder: null },
} as const satisfies Record<string, V2ImageFile>;

export type V2ImageKey = keyof typeof V2_IMAGE_FILES;

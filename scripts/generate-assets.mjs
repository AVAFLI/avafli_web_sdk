#!/usr/bin/env node
/**
 * Publishes the checked-in binary assets in /assets (fonts + Figma imagery
 * copied from the iOS SDK's Resources bundle) as real, content-hashed files
 * and writes the manifest the SDK reads at runtime:
 *
 *   <out>/<name>.<8-char sha256>.<ext>      — served from
 *                                              https://sdk.avafli.com/sdk-assets/v2/
 *   src/ui/v2/assets.generated.ts            — file names, sizes, placeholders
 *
 * The SDK no longer embeds fonts or images (3.2.1): the bundles reference the
 * hashed URLs and the host serves them immutable for a year. The default
 * output directory is the website repo's public folder next to this one;
 * override with AVAFLI_ASSET_OUT. Re-run after changing anything under
 * /assets, then commit BOTH repos (a new hash is a new file; old files are
 * left in place so already-shipped SDK versions keep working):
 *
 *   node scripts/generate-assets.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(
  process.env.AVAFLI_ASSET_OUT ?? join(root, '..', 'avafli-website', 'public', 'sdk-assets', 'v2')
);

const hash8 = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 8);

const fonts = [
  { name: 'inter-400', family: 'Avafli Inter', weight: 400, file: 'assets/fonts/inter-v20-latin-regular.ttf' },
  { name: 'inter-500', family: 'Avafli Inter', weight: 500, file: 'assets/fonts/inter-v20-latin-500.ttf' },
  { name: 'inter-600', family: 'Avafli Inter', weight: 600, file: 'assets/fonts/inter-v20-latin-600.ttf' },
  { name: 'inter-700', family: 'Avafli Inter', weight: 700, file: 'assets/fonts/inter-v20-latin-700.ttf' },
  { name: 'inter-800', family: 'Avafli Inter', weight: 800, file: 'assets/fonts/inter-v20-latin-800.ttf' },
  { name: 'inter-900', family: 'Avafli Inter', weight: 900, file: 'assets/fonts/inter-v20-latin-900.ttf' },
  { name: 'oswald-500', family: 'Avafli Oswald', weight: 500, file: 'assets/fonts/oswald-v57-latin-500.ttf' },
  { name: 'oswald-700', family: 'Avafli Oswald', weight: 700, file: 'assets/fonts/oswald-v57-latin-700.ttf' },
];

/**
 * `placeholder` is the solid colour painted behind the <img> box until the
 * bytes arrive (null = the art is transparent; the box is reserved, nothing
 * is painted).
 */
const images = {
  /** Default prize hero (money pile on white) — used when the publisher hasn't set a prize image. */
  cashHero: { name: 'cash-hero', file: 'assets/img/cash-hero-single.jpg', doc: 'Default prize hero (money pile) — used when the publisher has not set a prize image.', placeholder: '#ffffff' },
  /** Gold-sparkle art behind the winner dialog. */
  winnerModalBg: { name: 'winner-modal-bg', file: 'assets/img/winner-modal-bg.jpg', doc: 'Gold-sparkle art behind the winner dialog.', placeholder: '#2a1706' },
  /** Trophy (winner banner + dialog). */
  trophy: { name: 'trophy', file: 'assets/img/trophy.png', doc: 'Trophy (winner banner + dialog).', placeholder: null },
  /** Static white circle-check for COMPLETED streak tiles. */
  checkCompleted: { name: 'check-tile-completed', file: 'assets/img/check-tile-completed.png', doc: 'Static white circle-check for COMPLETED streak tiles.', placeholder: null },
  /**
   * Joe's Figma confetti burst (34 frames / 2000ms, plays once) — one-shot
   * over the active tile at the reveal beat and over the Total Entries
   * count-up landing.
   */
  confettiBurst: { name: 'confetti-burst', file: 'assets/img/confetti-burst.gif', doc: "Joe's Figma confetti burst (34 frames / 2000ms, plays once).", placeholder: null },
};

// ─── Pixel dimensions (so the SDK can reserve each box before the bytes land) ───

function pngSize(b) {
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function gifSize(b) {
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}
function jpegSize(b) {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('bad JPEG marker');
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('JPEG SOF not found');
}
function imageSize(ext, b) {
  if (ext === 'png') return pngSize(b);
  if (ext === 'gif') return gifSize(b);
  if (ext === 'jpg' || ext === 'jpeg') return jpegSize(b);
  throw new Error(`unsupported image type ${ext}`);
}

mkdirSync(outDir, { recursive: true });
const existing = new Set(readdirSync(outDir));
const written = [];
const emit = (fileName, bytes) => {
  writeFileSync(join(outDir, fileName), bytes);
  written.push({ fileName, bytes: bytes.length, isNew: !existing.has(fileName) });
  return fileName;
};

let out = `/**
 * GENERATED FILE — do not edit by hand.
 * Run \`node scripts/generate-assets.mjs\` to regenerate from /assets.
 *
 * Manifest of the V2 experience's fonts and imagery. Since 3.2.1 the files
 * themselves are NOT embedded: they are served as content-hashed, immutable
 * files from the asset host (see src/assets.ts — \`ASSET_BASE\`, overridable
 * with \`assetBaseUrl\`). Each entry is a file name relative to that base.
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
`;

for (const f of fonts) {
  const woff2 = Buffer.from(await wawoff2.compress(readFileSync(join(root, f.file))));
  const fileName = emit(`${f.name}.${hash8(woff2)}.woff2`, woff2);
  out += `  { family: '${f.family}', weight: ${f.weight}, file: '${fileName}' },\n`;
}
out += `];\n\nexport const V2_IMAGE_FILES = {\n`;
for (const [key, img] of Object.entries(images)) {
  const bytes = readFileSync(join(root, img.file));
  const ext = img.file.split('.').pop();
  const { width, height } = imageSize(ext, bytes);
  const fileName = emit(`${img.name}.${hash8(bytes)}.${ext}`, bytes);
  const placeholder = img.placeholder
    ? `'data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${img.placeholder}"/></svg>`
      )}'`
    : 'null';
  out += `  /** ${img.doc} */\n`;
  out += `  ${key}: { file: '${fileName}', width: ${width}, height: ${height}, placeholder: ${placeholder} },\n`;
}
out += `} as const satisfies Record<string, V2ImageFile>;\n\nexport type V2ImageKey = keyof typeof V2_IMAGE_FILES;\n`;

writeFileSync(join(root, 'src/ui/v2/assets.generated.ts'), out);

let total = 0;
for (const w of written) {
  total += w.bytes;
  console.log(`${w.isNew ? 'new    ' : 'same   '} ${w.fileName}  ${w.bytes} B`);
}
console.log(`Wrote ${written.length} files (${total} B) to ${outDir}`);
console.log('Wrote src/ui/v2/assets.generated.ts');
const stale = [...existing].filter((f) => !written.some((w) => w.fileName === f));
if (stale.length) {
  console.log(`Left in place (referenced by earlier SDK versions): ${stale.join(', ')}`);
}

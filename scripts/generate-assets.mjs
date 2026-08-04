#!/usr/bin/env node
/**
 * Generates src/ui/v2/assets.generated.ts from the checked-in binary assets in
 * /assets (fonts + Figma imagery copied from the iOS SDK's Resources bundle).
 *
 * The web SDK ships as a single self-contained JS file, so fonts and images are
 * embedded as data URIs. Re-run after changing anything under /assets:
 *
 *   node scripts/generate-assets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const dataUri = (relPath, mime) =>
  `data:${mime};base64,${readFileSync(join(root, relPath)).toString('base64')}`;

/** TTF → WOFF2 (pure-JS wawoff2), emitted as a data URI. Roughly halves font payload. */
const woff2DataUri = async (relPath) => {
  const woff2 = await wawoff2.compress(readFileSync(join(root, relPath)));
  return `data:font/woff2;base64,${Buffer.from(woff2).toString('base64')}`;
};

const fonts = [
  { family: 'WINR Inter', weight: 400, file: 'assets/fonts/inter-v20-latin-regular.ttf' },
  { family: 'WINR Inter', weight: 500, file: 'assets/fonts/inter-v20-latin-500.ttf' },
  { family: 'WINR Inter', weight: 600, file: 'assets/fonts/inter-v20-latin-600.ttf' },
  { family: 'WINR Inter', weight: 700, file: 'assets/fonts/inter-v20-latin-700.ttf' },
  { family: 'WINR Inter', weight: 800, file: 'assets/fonts/inter-v20-latin-800.ttf' },
  { family: 'WINR Inter', weight: 900, file: 'assets/fonts/inter-v20-latin-900.ttf' },
  { family: 'WINR Oswald', weight: 500, file: 'assets/fonts/oswald-v57-latin-500.ttf' },
  { family: 'WINR Oswald', weight: 700, file: 'assets/fonts/oswald-v57-latin-700.ttf' },
];

const images = {
  /** Default prize hero (money pile) — used when the publisher hasn't set a prize image. */
  cashHero: ['assets/img/cash-hero-single.jpg', 'image/jpeg'],
  /** Gold-sparkle art behind the winner dialog. */
  winnerModalBg: ['assets/img/winner-modal-bg.jpg', 'image/jpeg'],
  /** Trophy (winner banner + dialog). */
  trophy: ['assets/img/trophy.png', 'image/png'],
  /** Static white circle-check for COMPLETED streak tiles. */
  checkCompleted: ['assets/img/check-tile-completed.png', 'image/png'],
};

let out = `/**
 * GENERATED FILE — do not edit by hand.
 * Run \`node scripts/generate-assets.mjs\` to regenerate from /assets.
 *
 * Bundled Inter/Oswald faces (WOFF2) + Figma imagery for the V2 experience,
 * embedded as data URIs so the SDK stays a single self-contained file (no CDN
 * fetches).
 */

export interface V2FontFace {
  family: string;
  weight: number;
  /** WOFF2 data URI — pair with format('woff2') in the @font-face src. */
  dataUri: string;
}

export const V2_FONT_FACES: V2FontFace[] = [
`;

for (const f of fonts) {
  out += `  { family: '${f.family}', weight: ${f.weight}, dataUri: '${await woff2DataUri(f.file)}' },\n`;
}
out += `];\n\nexport const V2_IMAGES = {\n`;
for (const [name, [file, mime]] of Object.entries(images)) {
  out += `  ${name}: '${dataUri(file, mime)}',\n`;
}
out += `} as const;\n`;

writeFileSync(join(root, 'src/ui/v2/assets.generated.ts'), out);
console.log('Wrote src/ui/v2/assets.generated.ts');

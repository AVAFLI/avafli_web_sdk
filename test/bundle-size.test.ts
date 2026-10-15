/**
 * Bundle size budget (SCALE_SPEC §5, 3.2.1).
 *
 * Builds the PRODUCTION (minified) bundles into a scratch directory with the
 * real rollup config and asserts:
 *   - the UMD script-tag bundle is one file, ≤ 250 KB;
 *   - the ESM boot chunk (configure → registerDevice, auto-open engine,
 *     offline queue) is ≤ 120 KB and reaches the drawer UI only through a
 *     dynamic import();
 *   - neither bundle embeds the fonts/imagery any more (no data: URIs for
 *     them — they are fetched from the asset host).
 * The actual sizes are printed so a regression is visible in the run log.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const KB = 1024;
const UMD_BUDGET = 250 * KB;
const ESM_BOOT_BUDGET = 120 * KB;

const root = resolve(__dirname, '..');
let outDir: string;

const size = (file: string): number => statSync(join(outDir, file)).size;
const kb = (bytes: number): string => `${(bytes / KB).toFixed(1)} KB`;

describe('bundle size budget', () => {
  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'avafli-sdk-size-'));
    execFileSync(
      process.execPath,
      [
        join(root, 'node_modules', 'rollup', 'dist', 'bin', 'rollup'),
        '-c',
        '--environment',
        `NODE_ENV:production,AVAFLI_OUT_DIR:${outDir}`,
      ],
      { cwd: root, stdio: 'pipe' }
    );
  }, 120_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('builds the three production files', () => {
    for (const f of ['avafli-sdk.umd.js', 'avafli-sdk.esm.js', 'avafli-sdk.ui.esm.js', 'avafli-sdk.d.ts']) {
      expect(existsSync(join(outDir, f)), f).toBe(true);
    }
  });

  it('UMD (script tag, single file) is within budget', () => {
    const umd = size('avafli-sdk.umd.js');
    console.log(`UMD avafli-sdk.umd.js: ${kb(umd)} (budget ${kb(UMD_BUDGET)})`);
    expect(umd).toBeLessThanOrEqual(UMD_BUDGET);
    // Single file: nothing imported at runtime.
    const src = readFileSync(join(outDir, 'avafli-sdk.umd.js'), 'utf8');
    expect(src).not.toMatch(/import\(["']\.\//);
  });

  it('ESM boot chunk is within budget and only reaches the UI through import()', () => {
    const boot = size('avafli-sdk.esm.js');
    const ui = size('avafli-sdk.ui.esm.js');
    console.log(
      `ESM boot avafli-sdk.esm.js: ${kb(boot)} (budget ${kb(ESM_BOOT_BUDGET)}); ` +
        `UI chunk avafli-sdk.ui.esm.js: ${kb(ui)}; total ${kb(boot + ui)}`
    );
    expect(boot).toBeLessThanOrEqual(ESM_BOOT_BUDGET);

    const bootSrc = readFileSync(join(outDir, 'avafli-sdk.esm.js'), 'utf8');
    const uiSrc = readFileSync(join(outDir, 'avafli-sdk.ui.esm.js'), 'utf8');
    // Boot → UI only lazily; UI → boot for the shared internals.
    expect(bootSrc).toMatch(/import\(["']\.\/avafli-sdk\.ui\.esm\.js["']\)/);
    expect(bootSrc).not.toMatch(/from\s*["']\.\/avafli-sdk\.ui\.esm\.js["']/);
    expect(uiSrc).toMatch(/from\s*["']\.\/avafli-sdk\.esm\.js["']/);
    expect(uiSrc).not.toMatch(/import\(/);
  });

  it('no bundle embeds the fonts or imagery as data URIs', () => {
    for (const f of ['avafli-sdk.umd.js', 'avafli-sdk.esm.js', 'avafli-sdk.ui.esm.js']) {
      const src = readFileSync(join(outDir, f), 'utf8');
      expect(src, f).not.toMatch(/data:font\//);
      expect(src, f).not.toMatch(/data:image\/(png|gif);base64/);
      // The only JPEG data URI is the claim-photo preview built at runtime
      // from the winner's own upload — never a literal base64 payload.
      expect(src, f).not.toMatch(/data:image\/jpeg;base64,[A-Za-z0-9+/]{64}/);
    }
    // The CDN base is what the UI references instead.
    expect(readFileSync(join(outDir, 'avafli-sdk.ui.esm.js'), 'utf8')).not.toMatch(
      /sdk-assets\/v2/
    );
    expect(readFileSync(join(outDir, 'avafli-sdk.esm.js'), 'utf8')).toMatch(
      /https:\/\/sdk\.avafli\.com\/sdk-assets\/v2/
    );
  });
});

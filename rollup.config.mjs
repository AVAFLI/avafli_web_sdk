import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const isProduction = process.env.NODE_ENV === 'production';
// Output directory — overridable so the bundle-size test can build a
// production bundle into a scratch directory without touching dist/.
const outDir = process.env.AVAFLI_OUT_DIR || 'dist';

const banner = `/*!
 * Avafli Web SDK
 * (c) ${new Date().getFullYear()} Avafli
 * Released under the MIT License
 */`;

const baseConfig = {
  input: 'src/index.ts',
  external: [],
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      // Must sit inside the rollup output dir (plugin-typescript checks).
      outDir,
      declaration: false,
      declarationMap: false,
      sourceMap: true,
    }),
  ],
};

const buildConfigs = [
  // ESM build — code-split (3.2.1): `avafli-sdk.esm.js` is the boot chunk
  // (configure → registerDevice, auto-open engine, offline queue); everything
  // under src/ui/v2 lands in `avafli-sdk.ui.esm.js`, fetched by a dynamic
  // import() the first time the drawer opens. Both files ship in the package.
  {
    ...baseConfig,
    output: {
      dir: outDir,
      entryFileNames: 'avafli-sdk.esm.js',
      // The split comes from the dynamic import() alone (src/experience-loader.ts):
      // whatever the entry reaches statically stays in the boot file; the UI
      // chunk imports the shared modules (types, logger, network) FROM it. A
      // manualChunks rule would let rollup fold those shared modules the other
      // way (experimentalMinChunkSize) and make boot depend on the UI chunk.
      chunkFileNames: 'avafli-sdk.[name].esm.js', // src/ui/v2/ui.ts → avafli-sdk.ui.esm.js
      format: 'esm',
      banner,
      sourcemap: true,
    },
    // The UI chunk imports the shared internals (types, logger, network client)
    // from the boot file, so the boot file carries a few extra, mangled named
    // exports beyond src/index.ts's public ones. 'strict' (the default) would
    // instead wrap the entry in a facade and push the shared code into the UI
    // chunk — the boot file would then statically depend on it.
    preserveEntrySignatures: 'allow-extension',
    plugins: [
      ...baseConfig.plugins,
      isProduction && terser({
        format: {
          comments: function(node, comment) {
            return comment.value.includes('Avafli Web SDK');
          }
        }
      }),
    ].filter(Boolean),
  },

  // UMD build — uses the UMD entry so the global `Avafli` is the class itself
  // (with named exports attached), making the documented `Avafli.configure(...)` work.
  {
    ...baseConfig,
    input: 'src/umd.ts',
    output: {
      file: `${outDir}/avafli-sdk.umd.js`,
      format: 'umd',
      name: 'Avafli',
      exports: 'default',
      // The script-tag bundle stays ONE file: the UI chunk's dynamic import()
      // is inlined (it still resolves asynchronously, on the next tick).
      inlineDynamicImports: true,
      banner,
      sourcemap: true,
    },
    plugins: [
      ...baseConfig.plugins,
      isProduction && terser({
        format: {
          comments: function(node, comment) {
            return comment.value.includes('Avafli Web SDK');
          }
        }
      }),
    ].filter(Boolean),
  },

  // TypeScript declarations
  {
    input: 'src/index.ts',
    output: {
      file: `${outDir}/avafli-sdk.d.ts`,
      format: 'esm',
    },
    plugins: [dts()],
  },
];

export default buildConfigs;
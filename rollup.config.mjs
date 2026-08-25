import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const isProduction = process.env.NODE_ENV === 'production';

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
      declaration: false,
      declarationMap: false,
      sourceMap: true,
    }),
  ],
};

const buildConfigs = [
  // ESM build
  {
    ...baseConfig,
    output: {
      file: 'dist/avafli-sdk.esm.js',
      format: 'esm',
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

  // UMD build — uses the UMD entry so the global `Avafli` is the class itself
  // (with named exports attached), making the documented `Avafli.configure(...)` work.
  {
    ...baseConfig,
    input: 'src/umd.ts',
    output: {
      file: 'dist/avafli-sdk.umd.js',
      format: 'umd',
      name: 'Avafli',
      exports: 'default',
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
      file: 'dist/avafli-sdk.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
];

export default buildConfigs;
import typescript from 'rollup-plugin-typescript2';
import { DEFAULT_EXTENSIONS } from '@babel/core';
import babel from '@rollup/plugin-babel';
import del from 'rollup-plugin-delete';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
);
const extensions = [...DEFAULT_EXTENSIONS, '.ts', '.tsx'];
const tscBin = require.resolve('typescript/bin/tsc');

const declaration = () => ({
  name: 'declaration',
  closeBundle() {
    execFileSync(
      process.execPath,
      [
        tscBin,
        '-p',
        path.join(packageDir, 'tsconfig.json'),
        '--emitDeclarationOnly',
        '--declaration',
        '--noEmit',
        'false',
      ],
      {
        cwd: packageDir,
        stdio: 'inherit',
      },
    );
  },
});

const plugins = [
  nodeResolve({
    extensions,
  }),
  commonjs(),
  typescript({
    useTsconfigDeclarationDir: true,
  }),
  babel({
    exclude: ['node_modules/**'],
    babelHelpers: 'runtime',
    extensions,
    plugins: ['@babel/plugin-transform-runtime'],
    presets: [
      [
        '@babel/env',
        {},
      ],
      '@babel/preset-typescript',
    ],
  }),
  replace({
    PKG_VERSION: `"${pkg.version}"`,
    preventAssignment: true,
  }),
  declaration(),
  // terser(),
];

/**
 * @type {import('rollup').RollupOptions}
 */
export default {
  input: 'src/index.ts',
  output: [
    {
      file: pkg.main,
      format: 'esm',
      sourcemap: true,
    },
  ],
  plugins: [...plugins, del({ targets: ['dist/*'] })],
  external: ['@lynx-js/react'],
};

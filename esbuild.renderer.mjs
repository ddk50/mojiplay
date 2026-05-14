// renderer (src/renderer/* + src/core/*) を 1 個の IIFE bundle にまとめる。
// fabric / fontkit は vendor/ から <script> でグローバルロードしているので、
// import 文は書かれていない (= esbuild は global 参照として残す)。
//
// 型チェックは tsc -p tsconfig.renderer.json (noEmit) が担当。esbuild は
// transpile + bundle のみで型チェックしない。

import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/renderer/app.ts'],
  bundle: true,
  outfile: 'dist/renderer/bundle.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  // 開発時の安心感のため minify はしない (Electron は配布前提でも devtools で
  // 読みたい場面が多い)。本番配布で気になったらここで切り替え。
  minify: false,
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('[esbuild] watching src/renderer/* and src/core/*');
} else {
  await build(opts);
}

// renderer process (Chromium / main world) を 1 個の IIFE bundle にまとめる。
// entry は src/window/renderer.ts (= main world の Composition Root)。
// そこから src/window/{core,usecases,repository,controllers,presenter}/* が
// 芋づる式に bundle 入り。
// fabric / fontkit は vendor/ から <script> でグローバルロードしているので、
// import 文は書かれていない (= esbuild は global 参照として残す)。
//
// 型チェックは tsc -p tsconfig.renderer.json (noEmit) が担当。esbuild は
// transpile + bundle のみで型チェックしない。

import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/window/renderer.ts'],
  bundle: true,
  outfile: 'dist/renderer/bundle.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  // 開発時の安心感のため minify はしない (Electron は配布前提でも devtools で
  // 読みたい場面が多い)。本番配布で気になったらここで切り替え。
  minify: false,
  // *.svg を文字列として bundle に埋め込む (Tool descriptor の iconSvg 用)。
  // 別ファイル管理にしておく方が手元のグラフィックエディタで編集しやすい。
  loader: {
    '.svg': 'text',
  },
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('[esbuild] watching src/window/**/*');
} else {
  await build(opts);
}

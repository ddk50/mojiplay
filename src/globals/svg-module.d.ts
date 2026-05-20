// SVG ファイルを文字列として import するための ambient module 宣言。
//
// esbuild 側で `.svg` を `text` loader で読み込む設定をしてあるので、
// `import iconSvg from '../../icons/foo.svg'` の戻り値は SVG ファイルの
// 中身そのままの string になる。本宣言は tsc -p tsconfig.renderer.json
// (および test 用 tsconfig) が `.svg` import を型解決できるようにするためのもの。

declare module '*.svg' {
  const content: string;
  export default content;
}

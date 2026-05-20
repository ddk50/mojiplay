// Jest 用の `.svg` import スタブ。
//
// 本番では esbuild の text loader が SVG ファイル中身を string として import するが、
// jest (ts-jest) は loader を持たないので `import x from '*.svg'` を解決できない。
// jest.config.js の moduleNameMapper で `\.svg$` を本ファイルに向け、テストでは
// 中身に依存しないダミー文字列を返す (テストは iconSvg を assert しない前提)。

export default '<svg data-test-stub="true"></svg>';

// fontkit の最小型宣言。UMD 版を public/vendor/fontkit.js から <script> 読み
// 込みしているので、グローバル `fontkit` からアクセスする。
// 参考: https://github.com/foliojs/fontkit
//
// 必要になり次第 API を追加する。実装自体はもっとリッチ (feature, variable font,
// layout 等) だが、現状必要なのは create / glyphForCodePoint / path のみ。
//
// module-mode (`declare global { namespace fontkit {...} } export {};`) で書く。
// script-mode の `declare namespace fontkit` は WebStorm / 一部 IDE の TS service
// がファイル discovery タイミング次第で namespace を見失うことがあるため避ける。

declare global {
  namespace fontkit {
    interface BBox {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    }

    interface Path {
      toSVG(): string;
      scale(sx: number, sy: number): Path;
      readonly bbox: BBox;
    }

    interface Glyph {
      readonly path: Path;
      readonly advanceWidth: number;
    }

    interface Font {
      readonly unitsPerEm: number;
      readonly ascent: number;
      readonly descent: number;
      readonly postscriptName: string;
      readonly familyName: string;
      glyphForCodePoint(codePoint: number): Glyph | null;
      // フォントに該当コードポイントのグリフが存在するかどうか。
      // false のとき glyphForCodePoint は .notdef (豆腐表示) を返すので、
      // 呼び出し前に必ずこれで確認すること。
      hasGlyphForCodePoint(codePoint: number): boolean;
    }

    // fontkit.create: 第2引数に postscriptName を渡すと、TTC の場合に特定の
    // サブフォントを選択する。単体フォントでは postscriptName は無視される。
    function create(buffer: Uint8Array | ArrayBuffer, postscriptName?: string): Font;
  }
}

export {};

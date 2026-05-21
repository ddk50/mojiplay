// アウトライン位置計算 (純粋関数)
//
// fabric.Text → fabric.Path 変換時、パスの world 座標を計算する算数部分だけを
// 切り出したモジュール。fabric / fontkit / DOM 非依存なので単体テスト可能。

/**
 * fabric.Text の baseline 計算定数 (fabric 5.3 source からの literal)。
 *
 * fabric は `fillText(textBaseline='alphabetic')` で描画し、各 Text instance に
 * `_fontSizeMult = 1.13` / `_fontSizeFraction = 0.222` を保持する (fabric 5.x で
 * per-instance に override されることは無い)。fabric の internal を毎回読まずに
 * literal として持つことで、`_fontSizeMult` / `_fontSizeFraction` への internal
 * access を不要にしている。fabric 6 で値が変わったら CI で位置回帰テストが落ちる
 * (test/outline-position.test.ts)。
 */
const FABRIC_FONT_SIZE_MULT = 1.13;
const FABRIC_FONT_SIZE_FRACTION = 0.222;

export interface OutlineTextAnchor {
  readonly left: number;
  readonly top: number;
  readonly fontSize: number;
}

export interface GlyphInkBBox {
  readonly minX: number;
  readonly minY: number;
}

export interface CanvasPosition {
  readonly left: number;
  readonly top: number;
}

/**
 * fabric.Text の世界座標と fontkit の glyph ink bbox から、対応する fabric.Path
 * の左上ワールド座標を計算する。
 *
 * ## 計算根拠
 * fabric 5.3 の `_renderTextCommon` / `_renderChars` を追跡すると、1行テキストの
 * baseline 世界 y は:
 *
 *   baseline = text.top + text.fontSize * FABRIC_FONT_SIZE_MULT * (1 - FABRIC_FONT_SIZE_FRACTION)
 *            ≈ text.top + text.fontSize * 0.879
 *
 * グリフインクの visual top-left は `(text.left + bbox.minX, baseline + bbox.minY)`。
 * `bbox.minY` は Y-flip 済みで、ascender 側 (baseline より上) が負値。
 *
 * ## 注意
 * 単純な `text.top + text.fontSize` ではない。fabric は内部で 1.13 倍の
 * mult と 0.222 の fraction という定数で baseline 位置をずらしており、この式を
 * 忠実に再現しないと 72pt で約 8.7px のズレが発生する。
 */
export function computeOutlinePathPosition(
  text: OutlineTextAnchor,
  bbox: GlyphInkBBox,
): CanvasPosition {
  const baselineY =
    text.top + text.fontSize * FABRIC_FONT_SIZE_MULT * (1 - FABRIC_FONT_SIZE_FRACTION);
  return {
    left: text.left + bbox.minX,
    top: baselineY + bbox.minY,
  };
}

// アウトライン位置計算 (純粋関数)
//
// fabric.Text → fabric.Path 変換時、パスの world 座標を計算する算数部分だけを
// 切り出したモジュール。fabric / fontkit / DOM 非依存なので単体テスト可能。

export interface OutlineTextAnchor {
  readonly left: number;
  readonly top: number;
  readonly fontSize: number;
  /** fabric.Text._fontSizeMult (fabric 5.3 default: 1.13) */
  readonly fontSizeMult?: number;
  /** fabric.Text._fontSizeFraction (fabric 5.3 default: 0.222) */
  readonly fontSizeFraction?: number;
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
 * fabric.Text は `fillText(textBaseline='alphabetic')` で描画する。fabric 5.3 の
 * `_renderTextCommon` / `_renderChars` を追跡すると、1行テキストの baseline 世界 y は:
 *
 *   baseline = text.top + text.fontSize * _fontSizeMult * (1 - _fontSizeFraction)
 *            ≈ text.top + text.fontSize * 0.879   (fabric デフォルト定数で)
 *
 * グリフインクの visual top-left は `(text.left + bbox.minX, baseline + bbox.minY)`。
 * `bbox.minY` は Y-flip 済みで、ascender 側 (baseline より上) が負値。
 *
 * ## 注意
 * 単純な `text.top + text.fontSize` ではない。fabric は内部で 1.13 倍の
 * `_fontSizeMult` と 0.222 の `_fontSizeFraction` という定数で baseline 位置を
 * ずらしており、この式を忠実に再現しないと 72pt で約 8.7px のズレが発生する。
 */
export function computeOutlinePathPosition(
  text: OutlineTextAnchor,
  bbox: GlyphInkBBox,
): CanvasPosition {
  const mult = text.fontSizeMult ?? 1.13;
  const frac = text.fontSizeFraction ?? 0.222;
  const baselineY = text.top + text.fontSize * mult * (1 - frac);
  return {
    left: text.left + bbox.minX,
    top:  baselineY + bbox.minY,
  };
}

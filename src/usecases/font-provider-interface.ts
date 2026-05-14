// FontProvider: 「font + codePoint → グリフパス (SVG path data + ink bbox)」を提供する
// output port。outline-text-to-path use case が内部実装 (fontkit / system font query) を
// 知らずにアウトライン化を行えるよう抽象化する。
//
// concrete 実装は renderer/font-provider-fontkit.ts (fontkit + window.queryLocalFonts)。
// test 時は FakeFontProvider を inject して固定の path data を返せる。

export interface GlyphQuery {
  /** font-family 名 (例: 'Arial' / 'Yu Gothic')。 */
  readonly family: string;
  /** font weight (100-900。'bold' などは呼び側で 700 等に正規化済み)。 */
  readonly weight: number;
  readonly italic: boolean;
  /** Unicode code point (= str.codePointAt(0))。 */
  readonly codePoint: number;
  /** ピクセル単位の font size。glyph path はここで scale 済みで返る。 */
  readonly fontSize: number;
}

export interface GlyphPathResult {
  /** SVG path data 文字列 (`'M0 0 L10 10 ...'`)。fontSize で scale 済み、Y-down。 */
  readonly pathData: string;
  /** Ink (描画) bbox。pathData と同じ座標系 (Y-down、ascender 側 = 負)。 */
  readonly bbox: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
}

export interface FontProvider {
  /** 指定 (family, weight, italic, codePoint, fontSize) のグリフパスを返す。
   *  font が利用不可 / glyph 不在 / parse 失敗等で null。 */
  getGlyphPath(query: GlyphQuery): Promise<GlyphPathResult | null>;
}

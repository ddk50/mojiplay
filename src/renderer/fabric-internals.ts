// fabric の undocumented internal フィールド / メソッドへのアクセスを集約する単一窓口。
//
// 背景: fabric 5.3.x は contextTop / upperCanvasEl / __charBounds / pathOffset /
// _setPositionDimensions 等を公式に export していない。これらに依存しないと
// アンカー編集 / アウトライン化 / IText 分割 / overlay 描画ができないが、call site で
// `(x as any)` を散らかしたり、global 名前空間に declaration merging で「公開 API の
// ように見せる嘘の型」を生やしたりすると、fabric 側の minor version bump で rename
// された時に runtime まで検出できない。
//
// 方針:
//   - 各 internal の型は **このファイル内でだけ** local 宣言する (global merging しない)。
//   - cast (`as unknown as ...`) は helper 内部に閉じ込め、call site は typed wrapper
//     しか触らない。
//   - fabric が internal を rename / 削除したら、修正範囲はこのファイル 1 つで完結する。
//   - fabric.Object.data は mojiplay 固有の user data なので、ここではなく
//     src/globals/fabric-augment.d.ts で素直に augment し続ける (= 嘘ではない拡張)。

interface CanvasInternal {
  readonly contextTop?: CanvasRenderingContext2D;
  readonly upperCanvasEl: HTMLCanvasElement;
  getRetinaScaling?(): number;
}

interface ITextInternal {
  isEditing?: boolean;
  hiddenTextarea?: HTMLTextAreaElement;
  _textLines?: ReadonlyArray<ReadonlyArray<string>>;
  __charBounds?: ReadonlyArray<ReadonlyArray<{ left: number; width: number }>>;
  initDimensions(): void;
}

interface TextInternal {
  _fontSizeMult?: number;
  _fontSizeFraction?: number;
}

interface PathInternal {
  pathOffset: { x: number; y: number };
  dirty?: boolean;
}

interface PolylinePrototypeInternal {
  _setPositionDimensions(this: fabric.Path, opts: { left?: number; top?: number }): void;
}

// ── Canvas ────────────────────────────────────────────────────────────────

/** fabric 内部の上層 canvas 要素 (DOM event の真の target / pointer hit-test 用)。 */
export function getUpperCanvasEl(c: fabric.Canvas): HTMLCanvasElement {
  return (c as unknown as CanvasInternal).upperCanvasEl;
}

/** overlay 描画用の上層 2D context (アンカー / ハンドル / marquee 等)。
 *  fabric が proactive に clearContext するため未取得のことがある。 */
export function getContextTop(c: fabric.Canvas): CanvasRenderingContext2D | undefined {
  return (c as unknown as CanvasInternal).contextTop;
}

/** retina スケール (= window.devicePixelRatio 相当)。contextTop に直接描画するときに
 *  setTransform で掛ける必要がある。 */
export function getRetinaScaling(c: fabric.Canvas): number {
  return (
    (c as unknown as CanvasInternal).getRetinaScaling?.() ??
    (typeof window !== 'undefined' ? window.devicePixelRatio : undefined) ??
    1
  );
}

// ── IText ─────────────────────────────────────────────────────────────────

/** IText が編集中か。null/undefined / 非 IText obj に対しても安全に false を返す。 */
export function isITextEditing(obj: fabric.Object | null | undefined): boolean {
  return !!(obj as ITextInternal | null | undefined)?.isEditing;
}

/** 編集モード時の hidden <textarea> にフォーカス。enterEditing 直後に呼ぶ。 */
export function focusITextTextarea(it: fabric.IText): void {
  (it as unknown as ITextInternal).hiddenTextarea?.focus();
}

/** IText の width/height/__charBounds を再算出させる。 */
export function initITextDimensions(it: fabric.IText): void {
  (it as unknown as ITextInternal).initDimensions();
}

/** IText の行分割済み文字列を取得。initDimensions 後に呼ぶこと。 */
export function getITextLines(it: fabric.IText): ReadonlyArray<ReadonlyArray<string>> {
  return (it as unknown as ITextInternal)._textLines ?? [];
}

/** ペアワイズカーニング込みの文字ごとの bbox。initDimensions 後に呼ぶこと。 */
export function getITextCharBounds(
  it: fabric.IText,
): ReadonlyArray<ReadonlyArray<{ left: number; width: number }>> {
  return (it as unknown as ITextInternal).__charBounds ?? [];
}

// ── Text ──────────────────────────────────────────────────────────────────

/** fabric.Text の baseline 計算に使う font size 補正定数 (5.3 default: 1.13)。 */
export function getFontSizeMult(t: fabric.Text): number | undefined {
  return (t as unknown as TextInternal)._fontSizeMult;
}

/** 同上 fraction (5.3 default: 0.222)。 */
export function getFontSizeFraction(t: fabric.Text): number | undefined {
  return (t as unknown as TextInternal)._fontSizeFraction;
}

// ── Path ──────────────────────────────────────────────────────────────────

/** path bbox 中心から (left, top) までのオフセット。 */
export function getPathOffset(p: fabric.Path): { x: number; y: number } {
  return (p as unknown as PathInternal).pathOffset;
}

/** path の path 配列を直接代入した後に呼ぶ再描画フラグ。 */
export function markPathDirty(p: fabric.Path): void {
  (p as unknown as PathInternal).dirty = true;
}

/** commands 変更後に width / height / pathOffset を再算出する。
 *  fabric.Path 自身は public method を持たず、prototype 経由で Polyline の internal を借用する。 */
export function recomputePathDimensions(
  p: fabric.Path,
  opts: { left?: number; top?: number },
): void {
  const proto = fabric.Polyline.prototype as unknown as PolylinePrototypeInternal;
  proto._setPositionDimensions.call(p, opts);
}

// fabric の undocumented internal フィールド / メソッドへのアクセスを集約する単一窓口。
//
// ── なぜ存在するか (= 設計思想ミスマッチ) ────────────────────────────────
//
// fabric は「raster ライクな object editor」として設計されている: object を 1 個ずつ
// 配置 / 移動 / 回転 / スケールし、内部状態 (path commands, text の文字配列, etc) は
// constructor で固める = post-construction に変えない、という前提に立っている。
//
// 一方 mojiplay は fabric を「vector editor + per-char text editor」として使う。これは
// 以下 3 点で fabric の前提から外れており、その都度 fabric の internal に依存する形で
// しか実装できない (= 公式 API には穴が無い):
//
//   1. per-char text manipulation
//      fabric は IText を 1 単位として扱う (= 1 個の object に 1 文字列)。mojiplay は
//      IText 編集後に 1 文字 = 1 fabric.Text に分解して個別に移動 / 回転 / 削除する。
//      この per-char 座標を得るのに fabric 内部の `__charBounds` / `_textLines` を
//      借用する (公式には「IText 内部の文字列レイアウト」を取り出す API は無い)。
//
//   2. fabric.Path の commands post-mutation
//      fabric.Path は「constructor で commands を固めて以後 render するだけ」が想定。
//      mojiplay はアンカー編集で commands を mutate し、bbox を再算出させる。fabric の
//      「正しい」やり方は `new fabric.Path(commands)` で作り直すことだが、これだと
//      object identity が変わる (= ObjectId キャッシュ / canonical handle が壊れる)。
//      identity を保ったまま再算出するため `_setPositionDimensions` / `pathOffset` /
//      `dirty` flag を借用する。
//
//   3. DOM event の capture phase 横取り
//      fabric は `upperCanvasEl` で DOM event を受け、内部処理してから object に
//      bubble する。mojiplay はアンカー hit test を fabric より先にやりたい (= fabric
//      の通常の object dragging を抑止して、白矢印モードでアンカーだけ拾う)。capture
//      phase で event を listen するため `upperCanvasEl` を直接掴む必要がある。
//
// 同様に overlay 描画 (`contextTop`) も「fabric の上に自前の ephemeral 描画を重ねる」
// 用途で、fabric の selection bracket と同じレイヤを再利用しているだけ (代替は自前
// canvas overlay の transform / DPI / event passthrough 同期、コスト大)。
//
// ── これは「直す」べきか? ────────────────────────────────────────────────
//
// 構造的なものなので、wrapper 整理の refactor では消えない。本当に消すには:
//   - fabric を捨てて自前 canvas system を書く (= 数千行)、または
//   - vector 編集部分を SVG + DOM に分離 (fabric は文字 / bitmap 表示だけに使う)
// のどちらかが必要。現状はそれを取らず、internal access を **この 1 ファイルに集約** で
// 妥協している。fabric が internal を rename / 削除したら修正範囲はここで完結する。
//
// ── 方針 ─────────────────────────────────────────────────────────────────
//
//   - 各 internal の型は **このファイル内でだけ** local 宣言する (global merging しない)。
//   - cast (`as unknown as ...`) は helper 内部に閉じ込め、call site は typed wrapper
//     しか触らない。
//   - fabric が docs で記載してる public API (Object.data / IText.isEditing /
//     Canvas.getRetinaScaling) は src/globals/fabric-augment.d.ts に書く (= 嘘ではない拡張)。
//   - per-instance override されない fabric source の literal 定数 (Text の
//     _fontSizeMult / _fontSizeFraction = 1.13 / 0.222) は src/core/outline-position.ts
//     に hardcode してある (= internal access せず literal で持つ。回帰は test で守る)。

interface CanvasInternal {
  readonly contextTop?: CanvasRenderingContext2D;
  readonly upperCanvasEl: HTMLCanvasElement;
}

interface ITextInternal {
  hiddenTextarea?: HTMLTextAreaElement;
  _textLines?: ReadonlyArray<ReadonlyArray<string>>;
  __charBounds?: ReadonlyArray<ReadonlyArray<{ left: number; width: number }>>;
  initDimensions(): void;
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

// ── IText ─────────────────────────────────────────────────────────────────

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

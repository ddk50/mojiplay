// フォント系 toolbar コントロール (family / style / size) の affordance 判定。
//
// アウトライン化済み path はフォント変更が効かない (適用してもサイレント no-op) ため、
// 選択中にフォント変更が効くオブジェクトが 1 つも無いときは UI を disable にする。
// 判定は fabric の type 文字列ではなく fontFamily の duck-typing (state.ts の
// isOutlineable 判定と同じ流儀)。DOM / fabric に依存しない pure module。

export interface FontEditableProbe {
  fontFamily?: unknown;
}

/** このオブジェクトにフォント props (family/style/size) が効くか。 */
export function canEditFont(obj: FontEditableProbe): boolean {
  return typeof obj.fontFamily === 'string' && obj.fontFamily !== '';
}

/**
 * フォント系コントロールを disable すべきか。
 *
 * 選択が空のときは false (= enable 維持)。新規 IText 生成時に font-current.ts が
 * これらの DOM 値を source of truth として読むため、非選択時に disable で残すと
 * 新規テキスト作成の UX が壊れる。
 */
export function shouldDisableFontControls(selection: ReadonlyArray<FontEditableProbe>): boolean {
  return selection.length > 0 && !selection.some(canEditFont);
}

// Keyboard shortcut binding table + matcher (pure data + pure function)。
//
// 旧 KeyboardController に if-chain で書かれていた「key + modifier → menu action」
// マッピングを宣言的なテーブルに置換。controller は match を 1 行 dispatch するだけ
// になり、binding table 自体は fabric / DOM 不知の pure data なので単体 test 容易。
//
// 例外: 矢印キー (アンカー移動) は parameterized (direction + magnitude) で 1 つの
// menu action に閉じない & precondition (mode + selection) が複雑なので table に
// 乗せず controller に inline 残す (move-selected-anchors-by-arrow.ts use case 経由)。
//
// IText 編集中の bypass / Enter による IText commit も table 外 (= keyboard event の
// 解釈 + fabric event chain trigger なので controller の event filter 責務)。

/** binding を発火させて良いかの runtime context (= controller が collect する)。 */
export interface BindingContext {
  /** canvas に active object (selection) があるか。 */
  readonly hasActiveObject: boolean;
  /** focus が toolbar の input 系要素にあるか (= browser の標準動作を妨げないため)。 */
  readonly isToolbarInput: boolean;
}

/** どの key + modifier の組合せにマッチさせるか (`undefined` は don't care)。 */
interface BindingMatch {
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  /** マッチさせる KeyboardEvent.key の値リスト (`['s', 'S']` で Shift と非 Shift 両方など)。 */
  readonly keys: ReadonlyArray<string>;
}

export interface KeyBinding {
  readonly match: BindingMatch;
  readonly phase: 'capture' | 'bubble';
  /** menuActions.execute に渡す action ID。 */
  readonly action: string;
  /**
   * 発火時に preventDefault するか。default true。
   * 例外: delete は browser 標準動作 (Backspace 戻る等) を抑止する必要が無く、
   * 抑止するとフォーム上で副作用がある場合があるので false。
   */
  readonly preventDefault?: boolean;
  /** 追加の発火条件 (selection 必要 / toolbar input でない 等)。 */
  readonly precondition?: (ctx: BindingContext) => boolean;
}

const requireSelectionAndNotToolbar = (ctx: BindingContext): boolean =>
  !ctx.isToolbarInput && ctx.hasActiveObject;

const notToolbarInput = (ctx: BindingContext): boolean => !ctx.isToolbarInput;

export const KEY_BINDINGS: ReadonlyArray<KeyBinding> = [
  // ── capture phase ─────────────────────────────────────────────────────
  // (fabric の keydown より先に奪いたいもの: undo/redo / file ops)

  /** Cmd+Z: undo (Shift 無し)。 */
  { match: { meta: true, shift: false, keys: ['z'] }, phase: 'capture', action: 'undo' },

  /** Cmd+Shift+Z: redo。`Z` (uppercase) は Shift 押下時の e.key。 */
  { match: { meta: true, shift: true, keys: ['z', 'Z'] }, phase: 'capture', action: 'redo' },

  /** Cmd+O: file-open。 */
  {
    match: { meta: true, shift: false, alt: false, keys: ['o', 'O'] },
    phase: 'capture',
    action: 'file-open',
  },

  /** Cmd+Shift+S: file-save-as。 */
  {
    match: { meta: true, shift: true, alt: false, keys: ['s', 'S'] },
    phase: 'capture',
    action: 'file-save-as',
  },

  /** Cmd+S: file-save (Shift 無し、`s` lowercase のみ)。 */
  {
    match: { meta: true, shift: false, alt: false, keys: ['s'] },
    phase: 'capture',
    action: 'file-save',
  },

  // ── bubble phase ───────────────────────────────────────────────────────

  /** Cmd+C: 選択を PNG copy。toolbar input focus 中は browser 標準コピーを優先。 */
  {
    match: { meta: true, shift: false, alt: false, keys: ['c', 'C'] },
    phase: 'bubble',
    action: 'copy',
    precondition: requireSelectionAndNotToolbar,
  },

  /** Delete / Backspace: 選択削除。preventDefault 無し (browser 標準を妨げない)。 */
  {
    match: { keys: ['Delete', 'Backspace'] },
    phase: 'bubble',
    action: 'delete',
    preventDefault: false,
    precondition: notToolbarInput,
  },

  /** Cmd+D: 選択を複製 (Affinity / Sketch 慣例)。 */
  {
    match: { meta: true, shift: false, alt: false, keys: ['d', 'D'] },
    phase: 'bubble',
    action: 'duplicate',
    precondition: requireSelectionAndNotToolbar,
  },

  /** Cmd+Shift+O: 選択中テキストをアウトライン化 (Illustrator 慣例)。 */
  { match: { meta: true, shift: true, keys: ['O', 'o'] }, phase: 'bubble', action: 'outline' },

  /** F12: DevTools 開閉。modifier に関係なくマッチ。 */
  { match: { keys: ['F12'] }, phase: 'bubble', action: 'devtools' },

  /** Cmd+Shift+I: DevTools 開閉 (Chrome / VSCode 慣例)。 */
  { match: { meta: true, shift: true, keys: ['I', 'i'] }, phase: 'bubble', action: 'devtools' },
];

/** KeyboardEvent と現 phase / context にマッチする最初の binding を返す。無ければ null。 */
export function matchKeyBinding(
  e: KeyboardEvent,
  phase: 'capture' | 'bubble',
  ctx: BindingContext,
): KeyBinding | null {
  const meta = e.metaKey || e.ctrlKey;
  for (const b of KEY_BINDINGS) {
    if (b.phase !== phase) continue;
    const m = b.match;
    if (m.meta !== undefined && m.meta !== meta) continue;
    if (m.shift !== undefined && m.shift !== e.shiftKey) continue;
    if (m.alt !== undefined && m.alt !== e.altKey) continue;
    if (!m.keys.includes(e.key)) continue;
    if (b.precondition && !b.precondition(ctx)) continue;
    return b;
  }
  return null;
}

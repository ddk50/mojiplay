// Tool 抽象の境界 (interface) 定義 (純粋、fabric / DOM 非依存)。
//
// 「ツール」= ユーザがあるモードに入った時の挙動全体を 1 つのオブジェクトに
// まとめたもの。app.ts の散在する if 文を分離してテスト可能にするのが目的。
//
// State (抽象契約 — Tool / app.ts / menu が共通で使う) は ../state.ts を参照。
// 本ファイルは Tool / PointerInput / MovingTarget 等、ツール特有の入力型と Tool 自体の
// interface を集約する。
//
// 設計方針:
//   - 入力 (PointerInput, MovingTarget) は最小限のフィールドのみで fabric/DOM
//     を露出させない。
//   - Tool は副作用を State.* メソッド経由でしか出さない (= 中間更新 / push /
//     selection 変更は全部 state 経由)。test では Fake な State を渡せば Tool の
//     挙動を unit test 可能。
//
// 各ツール実装は本ファイルの Tool 型と State 型に依存し、本ファイルは fabric を
// 一切知らない。

import type { State } from '../../core/state';

// ── 入力 ─────────────────────────────────────────────────────────────────

export interface PointerInput {
  readonly screenX: number;  // upperCanvas DOM の topleft 基準 (px)
  readonly screenY: number;
  readonly worldX: number;   // canvas オブジェクト空間
  readonly worldY: number;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

// fabric の object:moving イベントで対象オブジェクトに使う最小 API。
// snap 等で left/top を読み書きするだけなので fabric.Object は露出させない。
export interface MovingTarget {
  getLeft(): number;
  getTop(): number;
  setLeft(v: number): void;
  setTop(v: number): void;
}

// fabric の mouse:down イベント (fabric の hit-test 後) を抽象化。
// TextTool は target が無いキャンバス空き領域クリックで IText を生成するため
// hasTarget が必要。
export interface CanvasMouseDownInput {
  readonly worldX: number;
  readonly worldY: number;
  readonly hasTarget: boolean;
}

// ツール自身が UI に表示するメタ情報。toolbar が tools 配列を iterate して
// 動的にボタンを生成する際に使う。
//
// - id:      currentMode キーと同じ識別子 ('select-group' 等)
// - label:   button の title (= ツールチップ) に表示する人間可読ラベル
// - iconSvg: button.innerHTML に流す SVG (or 任意の HTML) 文字列。renderer の
//            CSS class (tool-icon, outline-arrow, pen-icon, pen-nib 等) を参照
//            するのは許容 (renderer/style.css 側で定義済の package である前提)
//
// 依存方向: tool → renderer の一方通行。tool が UI 表現の文字列を自己完結で
// 宣言し、renderer (toolbar.ts) は受け取った文字列をそのまま innerHTML に
// 流す pure sink として振る舞う。中間 registry は使わない (key と registry
// 双方の維持コストを避けるため)。
//
// "core/tools が DOM を触らない" 原則は守られる: tool は string 値を保持する
// だけで document.* / fabric には触れない。
export interface ToolDescriptor {
  readonly id:      string;
  readonly label:   string;
  readonly iconSvg: string;
}

// ── ツール ──────────────────────────────────────────────────────────────

export type PointerHandled = 'consumed' | 'pass';

export interface Tool {
  // ツール ID + UI メタ情報。toolbar から参照される (詳細は ToolDescriptor)。
  readonly descriptor: ToolDescriptor;

  onActivate(state: State): void;
  onDeactivate(state: State): void;

  // 'consumed' を返した場合、呼び出し側 (app.ts) は fabric への伝播を抑止する
  // (DOM capture phase での stopImmediatePropagation 相当)。
  onPointerDown(e: PointerInput, state: State): PointerHandled;
  onPointerMove(e: PointerInput, state: State): void;
  onPointerUp(e: PointerInput, state: State): void;

  // ドラッグ中かどうか。dispatcher の hover ロジックは drag 中スキップしたい。
  isDragging(): boolean;

  // fabric の object:moving (= パス全体のドラッグ) ハンドラ。
  // snap 等で target の left/top を書き換えるツールがここを実装する。
  onObjectMoving(target: MovingTarget, e: { altKey: boolean }, state: State): void;

  // fabric の selection:created / selection:updated。SelectGroupTool が実装。
  onSelectionChanged(state: State): void;

  // fabric の mouse:down (fabric の hit-test 後)。TextTool が実装。
  // DOM capture mousedown より後、fabric の選択処理の一部として発火する。
  onCanvasMouseDown(e: CanvasMouseDownInput, state: State): void;
}

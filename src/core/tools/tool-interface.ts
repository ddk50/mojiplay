// ツール抽象の境界 (interface) 定義 (純粋、fabric / DOM 非依存)。
//
// 「ツール」= ユーザがあるモードに入った時の挙動全体を 1 つのオブジェクトに
// まとめたもの。app.ts の散在する if 文を分離してテスト可能にするのが目的。
// 本ファイルは Tool / ToolHost / PathHandle / ObjectHandle 等、ツールと
// ホスト (renderer) の間で授受される契約一式を集約する。データ ADT は
// ../path/types.ts (Point / PathCommand など) と分離している。
//
// 設計方針:
//   - 入力 (PointerInput, MovingTarget) は最小限のフィールドのみで fabric/DOM
//     を露出させない。
//   - PathHandle は path への副作用 (commands 更新, bbox 確定) を host 側に
//     閉じ込める抽象。test では FakePathHandle で挙動を検証できる。
//   - ToolHost は host 側ファサード。canvas.requestRenderAll や cursor 設定の
//     現実装は app.ts 側の adapter が担う。test では FakeToolHost を渡す。
//
// 各ツール実装は本ファイルの型に依存し、本ファイルは fabric を一切知らない。

import type { Point, PathCommand } from '../path/types';
import type { Mat2x3 } from '../path/coords';

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

// 選択操作用の最小 ObjectHandle。
// 現状は groupId だけで足りる (黒矢印の自動展開) が、後で型情報や outlined フラグ
// が要るツールが出てきたら拡張する。host が fabric.Object との対応関係を内部で保つ
// ので、tool 側は handle を不透明な ID として === 比較できれば良い。
//
// 規約: ToolHost.getActiveObjects / getAllObjects の実装は、同じ対象オブジェクトに
// 対しては必ず同じ handle instance を返すこと (canonical 化)。SelectGroupTool は
// 「現在の選択 == 展開後の選択」を identity 比較で判定するため、毎回別 instance を
// 返すと無限再帰に陥る。
export interface ObjectHandle {
  getGroupId(): string | undefined;
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

// TextTool が host に渡す生成リクエストのフォントプロパティ。
// fabric.IText の生成に必要な最小セット。
export interface TextCreateProps {
  readonly fontFamily:  string;
  readonly fontSize:    number;
  readonly fontWeight:  number | string;
  readonly fontStyle:   'normal' | 'italic';
  readonly fill:        string;
}

// ── パスへの副作用 ──────────────────────────────────────────────────────

export interface PathSnapshot {
  readonly commands: ReadonlyArray<PathCommand>;
  readonly pathMatrix: Mat2x3;     // calcTransformMatrix の結果 (local-pathOffset → world)
  readonly pathOffset: Point;
}

export interface PathHandle {
  // 現時点のコマンド配列 + 変換行列 + pathOffset を読み出す。
  // tool が連続呼び出しする前提なので副作用無し。
  snapshot(): PathSnapshot;

  // ドラッグ中の中間更新。bbox 再計算は走らない (重いので drag end にまとめる)。
  setCommands(cmds: ReadonlyArray<PathCommand>): void;

  // ドラッグ終了時に呼ぶ。bbox / pathOffset 再計算と object:modified 通知をまとめる。
  finalizeEdit(): void;
}

// ── ツールホスト (renderer ファサード) ─────────────────────────────────

export interface ToolHost {
  // 現在編集対象のパス (アウトライン化済 fabric.Path)。それ以外なら null。
  getActivePath(): PathHandle | null;

  // ビューポート変換行列 (canvas.viewportTransform)。スクリーン↔ワールドに使う。
  getViewportMatrix(): Mat2x3;

  // 描画要求。fabric では canvas.requestRenderAll() に対応。
  requestRerender(): void;

  // upperCanvas のカーソル設定。空文字でデフォルトに戻す。
  setCursor(c: string): void;

  // 選択管理 (主に SelectGroupTool が利用)
  getActiveObjects(): ReadonlyArray<ObjectHandle>;
  getAllObjects():    ReadonlyArray<ObjectHandle>;
  setActiveSelection(objs: ReadonlyArray<ObjectHandle>): void;

  // テキスト生成 (TextTool が利用)。fabric.IText の生成と編集モード突入は host に閉じる。
  createTextAt(x: number, y: number, props: TextCreateProps): void;
}

// ── ツール ──────────────────────────────────────────────────────────────

export type PointerHandled = 'consumed' | 'pass';

export interface Tool {
  // ツール ID + UI メタ情報。toolbar から参照される (詳細は ToolDescriptor)。
  readonly descriptor: ToolDescriptor;

  onActivate(host: ToolHost): void;
  onDeactivate(host: ToolHost): void;

  // 'consumed' を返した場合、呼び出し側 (app.ts) は fabric への伝播を抑止する
  // (DOM capture phase での stopImmediatePropagation 相当)。
  onPointerDown(e: PointerInput, host: ToolHost): PointerHandled;
  onPointerMove(e: PointerInput, host: ToolHost): void;
  onPointerUp(e: PointerInput, host: ToolHost): void;

  // ドラッグ中かどうか。dispatcher の hover ロジックは drag 中スキップしたい。
  isDragging(): boolean;

  // fabric の object:moving (= パス全体のドラッグ) ハンドラ。
  // snap 等で target の left/top を書き換えるツールがここを実装する。
  onObjectMoving(target: MovingTarget, e: { altKey: boolean }, host: ToolHost): void;

  // fabric の selection:created / selection:updated。SelectGroupTool が実装。
  onSelectionChanged(host: ToolHost): void;

  // fabric の mouse:down (fabric の hit-test 後)。TextTool が実装。
  // DOM capture mousedown より後、fabric の選択処理の一部として発火する。
  onCanvasMouseDown(e: CanvasMouseDownInput, host: ToolHost): void;
}

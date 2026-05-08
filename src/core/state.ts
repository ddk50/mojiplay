// State の interface (= 抽象契約) と、State が出し入れする object/path 抽象の型定義。
//
// State は「mojiplay のドキュメント層全体への操作 IF」を提供する一級概念。
// Tool / app.ts / menu / toolbar はみな State 経由で fabric.Canvas を読み書きする。
// 実装は renderer/state.ts の `class State implements StateContract` (alias)。
//
// 設計方針:
//   - 本ファイルは fabric / DOM 不知 (core/ 配下なので)
//   - State の public 契約 = この interface
//   - 実装側が canvas を持つかどうかは不問 (現実装は fabric.Canvas を内包)
//   - ToolHost という別 interface は持たない。Tool は State 全体を method 引数で受け、
//     使うメソッドだけ呼ぶ (Interface Segregation は TS の structural typing で
//     十分)。State という名前 1 つで責任を表現するのが mojiplay の設計判断
//
// PathHandle / ObjectHandle / PathSnapshot / TextCreateProps もここに同居。
// State.getActivePath() / getActiveObjects() / setActiveSelection() / createTextAt()
// から流れる型なので、State と一緒に居るのが自然。tool-interface.ts に置くと
// 循環参照になる (tool-interface 側が State を import するため)。

import type { Point, PathCommand } from './path/types';
import type { Mat2x3 } from './path/coords';
import type { Command, ObjectSnapshot } from './history/types';
import type { ObjectId } from './object-id';

// ── object / path / text 抽象 ─────────────────────────────────────────────

/**
 * 選択操作用の最小 ObjectHandle。
 *
 * 規約: State.getActiveObjects / getAllObjects の実装は、同じ対象オブジェクトに
 * 対しては必ず同じ handle instance を返すこと (canonical 化)。SelectGroupTool は
 * 「現在の選択 == 展開後の選択」を identity 比較で判定するため、毎回別 instance を
 * 返すと無限再帰に陥る。
 */
export interface ObjectHandle {
  getGroupId(): string | undefined;
}

/** path snapshot — Tool が drag 中の math 計算に使う read-only な path 状態。 */
export interface PathSnapshot {
  readonly commands: ReadonlyArray<PathCommand>;
  readonly pathMatrix: Mat2x3;     // calcTransformMatrix の結果 (local-pathOffset → world)
  readonly pathOffset: Point;
}

/** Tool が path を編集するための副作用 IF。 */
export interface PathHandle {
  // 現時点のコマンド配列 + 変換行列 + pathOffset を読み出す (副作用無し)。
  snapshot(): PathSnapshot;

  // ドラッグ中の中間更新。bbox 再計算は走らない (重いので drag end にまとめる)。
  setCommands(cmds: ReadonlyArray<PathCommand>): void;

  // ドラッグ終了時に呼ぶ。bbox / pathOffset 再計算と object:modified 通知をまとめる。
  finalizeEdit(): void;

  // History Command 構築用: object の identity と state-jump 用 snapshot。
  // pointerDown 時に before を、finalizeEdit 後に after を捕捉して Command に詰める。
  getId(): ObjectId;
  captureForHistory(): ObjectSnapshot;
}

/** TextTool が State.createTextAt に渡す生成リクエストのフォントプロパティ。 */
export interface TextCreateProps {
  readonly fontFamily:  string;
  readonly fontSize:    number;
  readonly fontWeight:  number | string;
  readonly fontStyle:   'normal' | 'italic';
  readonly fill:        string;
}

// ── State (抽象契約) ───────────────────────────────────────────────────────

/**
 * mojiplay のドキュメント層への単一の操作 IF。
 *
 * Tool / app.ts / menu はみな State を受け取って操作する。State の concrete 実装
 * (renderer/state.ts) は fabric.Canvas を内部に保持し、本 interface のメソッドを
 * fabric API に翻訳する。
 *
 * Phase A の責務範囲: ドキュメント (object 群) の CRUD / 履歴 / 永続化。camera 層
 * (viewport / selection / tool mode / IText 編集中 state) は履歴対象外。詳細は
 * CLAUDE.md「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」参照。
 */
export interface State {
  // ── object / path / text の取り出し / 設定 (主に Tool が使う) ──

  /** 現在編集対象のパス (アウトライン化済 path)。それ以外なら null。 */
  getActivePath(): PathHandle | null;

  /** ビューポート変換行列 (canvas.viewportTransform 相当)。 */
  getViewportMatrix(): Mat2x3;

  /** 描画要求 (canvas.requestRenderAll 相当)。 */
  requestRerender(): void;

  /** upperCanvas のカーソル設定。空文字でデフォルトに戻す。 */
  setCursor(c: string): void;

  /** 現在 active な object 群 (主に SelectGroupTool が使う)。 */
  getActiveObjects(): ReadonlyArray<ObjectHandle>;

  /** 全 object 群。 */
  getAllObjects(): ReadonlyArray<ObjectHandle>;

  /** 選択を設定。fabric の ActiveSelection 構築は State 側で。 */
  setActiveSelection(handles: ReadonlyArray<ObjectHandle>): void;

  /** テキスト生成 (TextTool が空き領域クリックで呼ぶ)。 */
  createTextAt(x: number, y: number, props: TextCreateProps): void;

  // ── History 操作 ──

  /**
   * History Command を push。Tool が history を直接持たず State 経由で push する。
   * 詳細は CLAUDE.md「Undo/Redo + 永続化に向けた State / Viewport 分離モデル」参照。
   */
  pushCommand(cmd: Command): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ── 永続化 (将来用、現状 stub) ──

  serialize(): unknown;
  loadSerialized(data: unknown): void;

  // ── debug ──

  /** History の論理順 Command 列 (debug / 永続化 inspection 用)。 */
  linearizeHistory(): ReadonlyArray<Command>;
}

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

import type { Point } from './path/types';
import type { Mat2x3 } from './path/coords';
import type { Path } from './path/path';
import type { Command, ObjectSnapshot } from './history/types';
import type { ObjectId } from './object-id';
import type { DocumentSnapshot } from './document/snapshot';

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
  readonly path: Path;
  readonly pathMatrix: Mat2x3; // calcTransformMatrix の結果 (local-pathOffset → world)
  readonly pathOffset: Point;
}

/** Tool が path を編集するための副作用 IF。 */
export interface PathHandle {
  // 現時点の Path + 変換行列 + pathOffset を読み出す (副作用無し)。
  snapshot(): PathSnapshot;

  // ドラッグ中の中間更新。bbox 再計算は走らない (重いので drag end にまとめる)。
  setPath(path: Path): void;

  // ドラッグ終了時に呼ぶ。bbox / pathOffset 再計算と object:modified 通知をまとめる。
  finalizeEdit(): void;

  // History Command 構築用: object の identity と state-jump 用 snapshot。
  // pointerDown 時に before を、finalizeEdit 後に after を捕捉して Command に詰める。
  getId(): ObjectId;
  captureForHistory(): ObjectSnapshot;
}

/** TextTool が State.createTextAt に渡す生成リクエストのフォントプロパティ。 */
export interface TextCreateProps {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: number | string;
  readonly fontStyle: 'normal' | 'italic';
  readonly fill: string;
}

/** ツールモード識別子。Controller (KeyboardController / CanvasInputController) と
 *  State (commitIText 時の selectable 判定 + canvas 設定) で共有する。 */
export type Mode = 'select-group' | 'select-char' | 'text' | 'pen-add' | 'pen-remove';

/** 選択中オブジェクトに一括適用するプロパティ (toolbar property 変更用)。
 *  fabric 不知の型として core/ に置く。実装側 (renderer/state.ts) で fabric props にマップ。 */
export interface SelectionProps {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number | string;
  readonly fontStyle?: 'normal' | 'italic' | 'oblique';
  readonly fill?: string;
  readonly angle?: number;
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

  // ── 永続化 (snapshot 境界変換) ──

  /**
   * 現在の canvas 全 object を Snapshot として出す境界変換。
   * 中身は format / version + canvas.toJSON(['data']) の出力。
   */
  toSnapshot(): DocumentSnapshot;

  /**
   * Snapshot を canvas に取り込む境界変換。内部で:
   *   - canvas.clear() → loadFromJSON (async)
   *   - viewportTransform を identity にリセット
   *   - clearHistory() (= history 空 + tokenCounter 進行 + onMutate listeners 通知)
   * 完了まで Promise が resolve しないので、呼び出し側は必ず await すること。
   */
  applySnapshot(s: DocumentSnapshot): Promise<void>;

  /**
   * IText 編集中なら commit を完了させる (= save 直前に呼ぶ)。
   * 実装内部で 'text:editing:exited' を hook して 1 文字ずつの fabric.Text に分割し、
   * N×objectCreated を compound として history に push する。
   * 詳細は CLAUDE.md「文字モデル」「Enter 確定フロー」参照。
   */
  commitActiveText(): void;

  // ── 高レベル副作用 (= 旧 app.ts の business logic を State 内に閉じ込め) ──

  /**
   * 選択中の object 群に property を一括適用 (toolbar property 変更用)。
   * 各 object の before/after snapshot を取って Command 化、no-op (差分ゼロ) の
   * object は skip、残りを compound として history に push する。
   */
  applyPropsToSelection(props: SelectionProps): void;

  /**
   * モード切替の canvas 副作用を吸収する (cursor / selectable / evented /
   * canvas.selection / discardActiveObject)。Controller の Tool dispatch
   * (onActivate / onDeactivate) は呼び元 (Controller) に残す。
   * mode は State 内部にも保持され、commitActiveText の selectable 判定と
   * getCurrentMode() で参照される。
   */
  setMode(mode: Mode): void;

  /** 現在のモード。KeyboardController などが分岐に使う。 */
  getCurrentMode(): Mode;

  /** canvas を全クリア (button: クリア / 起動初期化想定)。 */
  clearAll(): void;

  /** contextTop に描かれている overlay (アンカー / ハンドル) をクリア。
   *  選択変更 / モード切替時に Controller が呼ぶ。 */
  clearOverlay(): void;

  // ── dirty tracking ──

  /**
   * 保存判定用の opaque token。等価なら state は「同一」とみなせる。
   * pushCommand / undo / redo / clearHistory / applySnapshot で進行する。
   */
  getHistoryToken(): number;

  /**
   * state mutation 通知。token が進む全タイミングで cb が呼ばれる。
   * 返値は unsubscribe 関数。
   */
  onMutate(cb: () => void): () => void;

  /** 履歴クリア (load 後等)。tokenCounter も進めて onMutate を発火する。 */
  clearHistory(): void;

  // ── 高レベル selection 操作 (= 旧 actions/* の fabric 操作を State 内に閉じ込め) ──

  /**
   * 現在の zoom 倍率 (= canvas.getZoom() 相当)。
   * Use case が「画面上 N px 相当の canvas 座標オフセット」を計算する時に使う。
   */
  getZoom(): number;

  /**
   * focal point を中心に zoom を設定する (= canvas.zoomToPoint 相当)。camera 層の
   * 操作なので history には乗らない。
   * @param zoom 新しい zoom 倍率 (clamp は呼び側で済ませる前提)
   * @param focal screen 座標 (canvas DOM の origin 基準) の zoom 中心
   */
  zoomToPoint(zoom: number, focal: { x: number; y: number }): void;

  /** 選択中の object をすべて削除。history に compound objectDeleted を push。 */
  removeActiveObjects(): void;

  /**
   * 選択中の object を offset 分ずらして複製。新オブジェクトに objectId を発行、
   * 同一 groupId の元 objects は同一の新 groupId にまとめる (= 単語性を保つ)。
   * history に compound objectCreated を push、複製群を新 selection に。
   */
  duplicateActiveObjects(offset: { x: number; y: number }): void;

  /** 全 object を選択。history は変えない (= camera 層)。 */
  selectAllObjects(): void;

  /**
   * 選択中の Text (アウトライン化可能なもの) を Path に変換。
   * - 既に outlined な object はスキップ
   * - 各 Text 1 個 = compound (objectDeleted Text + objectCreated Path) として
   *   history に積み、最終的な compound としてまとめる
   * @returns 成否のサマリ。失敗詳細は呼び出し側で UI 表示するために返す。
   */
  outlineActiveTexts(): Promise<{
    succeeded: number;
    failedChars: string;
    failedFamilies: ReadonlyArray<string>;
  }>;

  /**
   * 現在の active object を PNG dataURL に export (clipboard コピー用)。
   * @param multiplier 解像度倍率 (= 通常 10、retina 相当)
   * @returns active object が無ければ null
   */
  exportActiveAsPngDataUrl(
    multiplier: number,
  ): { dataUrl: string; width: number; height: number } | null;

  /**
   * canvas 全体を PNG dataURL に export する。selection は事前に解除する
   * (selection bracket が PNG に焼き込まれないように)。
   * @param multiplier 解像度倍率 (= 通常 2)
   */
  exportCanvasAsPngDataUrl(multiplier: number): string;

  // ── debug ──

  /** History の論理順 Command 列 (debug / 永続化 inspection 用)。 */
  linearizeHistory(): ReadonlyArray<Command>;
}

// ツール抽象の型定義 (純粋、fabric / DOM 非依存)。
//
// 「ツール」= ユーザがあるモードに入った時の挙動全体を 1 つのオブジェクトに
// まとめたもの。app.ts の散在する if 文を分離してテスト可能にするのが目的。
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
//
// 共通型 (Point / PathCommand / HandleRef) は ../path/types.ts のグローバル
// 宣言を参照する (module: "none" によるクロスファイル global 共有)。
// Mat2x3 / PathTransform は ../path/coords.ts。

// ── 入力 ─────────────────────────────────────────────────────────────────

interface PointerInput {
  readonly screenX: number;  // upperCanvas DOM の topleft 基準 (px)
  readonly screenY: number;
  readonly worldX: number;   // canvas オブジェクト空間
  readonly worldY: number;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

// fabric の object:moving イベントで対象オブジェクトに使う最小 API。
// snap 等で left/top を読み書きするだけなので fabric.Object は露出させない。
interface MovingTarget {
  getLeft(): number;
  getTop(): number;
  setLeft(v: number): void;
  setTop(v: number): void;
}

// ── パスへの副作用 ──────────────────────────────────────────────────────

interface PathSnapshot {
  readonly commands: ReadonlyArray<PathCommand>;
  readonly pathMatrix: Mat2x3;     // calcTransformMatrix の結果 (local-pathOffset → world)
  readonly pathOffset: Point;
}

interface PathHandle {
  // 現時点のコマンド配列 + 変換行列 + pathOffset を読み出す。
  // tool が連続呼び出しする前提なので副作用無し。
  snapshot(): PathSnapshot;

  // ドラッグ中の中間更新。bbox 再計算は走らない (重いので drag end にまとめる)。
  setCommands(cmds: ReadonlyArray<PathCommand>): void;

  // ドラッグ終了時に呼ぶ。bbox / pathOffset 再計算と object:modified 通知をまとめる。
  finalizeEdit(): void;
}

// ── ツールホスト (renderer ファサード) ─────────────────────────────────

interface ToolHost {
  // 現在編集対象のパス (アウトライン化済 fabric.Path)。それ以外なら null。
  getActivePath(): PathHandle | null;

  // ビューポート変換行列 (canvas.viewportTransform)。スクリーン↔ワールドに使う。
  getViewportMatrix(): Mat2x3;

  // 描画要求。fabric では canvas.requestRenderAll() に対応。
  requestRerender(): void;

  // upperCanvas のカーソル設定。空文字でデフォルトに戻す。
  setCursor(c: string): void;
}

// ── ツール ──────────────────────────────────────────────────────────────

type PointerHandled = 'consumed' | 'pass';

interface Tool {
  onActivate(host: ToolHost): void;
  onDeactivate(host: ToolHost): void;

  // 'consumed' を返した場合、呼び出し側 (app.ts) は fabric への伝播を抑止する
  // (DOM capture phase での stopImmediatePropagation 相当)。
  onPointerDown(e: PointerInput, host: ToolHost): PointerHandled;
  onPointerMove(e: PointerInput, host: ToolHost): void;
  onPointerUp(e: PointerInput, host: ToolHost): void;

  // fabric の object:moving (= パス全体のドラッグ) ハンドラ。
  // snap 等で target の left/top を書き換えるツールがここを実装する。
  onObjectMoving(target: MovingTarget, e: { altKey: boolean }, host: ToolHost): void;
}

// 型のみのファイルだが、tsconfig.test の include に入れるために .ts として置く。
// runtime 出力は空。dual-mode export は不要 (型のみ)。
const __toolsTypesPlaceholder: 0 = 0; void __toolsTypesPlaceholder;

// CanvasInputController の public 契約。
//
// Impl は ./canvas-input-controller.ts の CanvasInputControllerImpl。test double は
// 本 interface を object literal で満たせばよい (= class type だと private field の
// nominal typing に阻まれて satisfies 不可)。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';

export interface CanvasInputControllerDeps {
  state: State;
  tools: Record<Mode, Tool>;
  selectCharTool: SelectCharTool;
  /** 中ボタン drag で mode 非依存に routing される手のひらツール (mode map 外)。 */
  handTool: Tool;
  /** イベント配線 (on/off) と座標変換 (getPointer / buildPointerInput) 専用。
   *  状態の読み書きは state 経由で行うこと (CLAUDE.md の canvas アクセス規約)。 */
  canvas: fabric.Canvas;
  /** zoom 変化後に呼ばれる callback (= タイトルバー % 表示更新等)。 */
  onZoomChanged: () => void;
}

export interface CanvasInputController {
  onUpperCanvasMouseDown(e: MouseEvent): void;
  onUpperCanvasMouseMove(e: MouseEvent): void;
  onCanvasMouseDown(opt: fabric.IEvent): void;
  onCanvasMouseWheel(e: fabric.IEvent): void;
  onObjectMoving(e: fabric.IEvent): void;
  onSelectionCleared(): void;
  onSelectionChanged(): void;
  attach(): void;
  detach(): void;
}

// CanvasInputController の public 契約。
//
// Impl は ./canvas-input-controller.ts の CanvasInputControllerImpl。test double は
// 本 interface を object literal で満たせばよい (= class type だと private field の
// nominal typing に阻まれて satisfies 不可)。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { ToolbarPresenter } from '../presenter/toolbar-presenter-interface';

export interface CanvasInputControllerDeps {
  state: State;
  tools: Record<Mode, Tool>;
  selectCharTool: SelectCharTool;
  canvas: fabric.Canvas;
  /** 選択変更 / 回転の toolbar 反映先 (内→外は Presenter に委譲、type-only 依存)。 */
  toolbar: ToolbarPresenter;
  /** zoom 変化後に呼ばれる callback (= タイトルバー % 表示更新等)。 */
  onZoomChanged: () => void;
}

export interface CanvasInputController {
  onUpperCanvasMouseDown(e: MouseEvent): void;
  onUpperCanvasMouseMove(e: MouseEvent): void;
  onCanvasMouseDown(opt: fabric.IEvent): void;
  onCanvasMouseWheel(e: fabric.IEvent): void;
  onObjectMoving(e: fabric.IEvent): void;
  onObjectRotating(e: fabric.IEvent): void;
  onSelectionCleared(): void;
  onSelectionChanged(): void;
  onAfterRender(): void;
  attach(): void;
  detach(): void;
}

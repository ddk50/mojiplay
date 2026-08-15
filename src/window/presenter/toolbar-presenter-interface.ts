// ToolbarPresenter の public 契約。
//
// toolbar の挙動 (mode ボタン生成 / 選択→表示同期 / 回転追従) に責任を持つ
// Presenter (内→外)。選択値をインスペクタへ映すのは View 同期であって業務判断
// ではないため、usecase ではなく Presenter として集約している。
// Impl は ./toolbar.ts の ToolbarPresenterImpl。
//
// 入力方向 (UI → State) の controllers/toolbar-interface.ts (ToolbarController)
// とは別概念なので注意。

import type { Tool } from '../usecases/tools/tool-interface';

export interface ToolbarPresenter {
  /** mode ボタン群を container に動的生成し、id → button マップを返す。
   *  ToolbarController.setMode が is-active class 切替でこのマップを参照する。 */
  buildModeButtons(
    tools: ReadonlyArray<Tool>,
    container: HTMLElement,
    onSelect: (id: string) => void,
  ): Record<string, HTMLButtonElement>;

  /** 選択中 object の props (font / size / color / rotation) をツールバーへ反映し、
   *  フォント変更が効かない選択ではフォント系コントロールを disable にする。
   *  fabric の selection:created / updated / cleared で呼ばれる想定。 */
  syncToSelection(canvas: fabric.Canvas): void;

  /** object:rotating で rotation インプットを追従させる。 */
  setRotation(angle: number): void;
}

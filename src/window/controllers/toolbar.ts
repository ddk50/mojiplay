// ToolbarController: 画面下中央のフローティングツールバー (= ツール選択) の
// Input Adapter。mode button の click を switchMode use case に dispatch し、
// 現在 mode の is-active class 追従 (= presentation) を負う。
//
// 右パネル (= Sidebar) のプロパティ入力は SidebarController の担当でここには無い。
//
// mode button 自体は presenter/toolbar.ts の buildModeButtons が動的生成するため、
// その呼び出しと button マップの受け渡しは drawing-screen.ts (Composition Root) で
// 行う。ToolbarController は受け取った modeButtons map の配線と追従だけを行う。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';
import type { ToolbarController, ToolbarControllerDeps } from './toolbar-interface';
import { switchMode } from '../presenter/switch-mode';

export class ToolbarControllerImpl implements ToolbarController {
  private readonly state: State;
  private readonly tools: Record<Mode, Tool>;
  private readonly modeButtons: Record<string, HTMLButtonElement>;

  constructor(deps: ToolbarControllerDeps) {
    this.state = deps.state;
    this.tools = deps.tools;
    this.modeButtons = deps.modeButtons;
  }

  // ====================================================================
  //  Public event handlers (= Controller の contract)
  // ====================================================================

  /** mode button click または初期化時に呼ぶ。
   *  is-active class 切替 (= presentation) + switchMode use case 呼び出し。 */
  readonly setMode = (m: Mode): void => {
    for (const k of Object.keys(this.modeButtons)) {
      this.modeButtons[k].classList.toggle('is-active', k === m);
    }
    switchMode(this.state, this.tools, m);
  };

  // ====================================================================
  //  Lifecycle (self-wiring convenience)
  // ====================================================================

  attach(): void {
    for (const id of Object.keys(this.modeButtons)) {
      this.modeButtons[id].addEventListener('click', () => this.setMode(id as Mode));
    }
    this.setMode(this.state.getCurrentMode());
  }

  detach(): void {
    // mode button listeners は無名 closure なので detach 不要 (window.unload で破棄)。
  }
}

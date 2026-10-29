// ToolbarController の public 契約。
//
// Toolbar = 画面下中央のフローティングツールバー (= ツール選択のみ)。右パネルの
// プロパティコントロールは SidebarController の担当。
//
// Impl は ./toolbar.ts の ToolbarControllerImpl。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';

export interface ToolbarControllerDeps {
  state: State;
  tools: Record<Mode, Tool>;
  /** presenter/toolbar.ts の buildModeButtons が生成した mode → button マップ。
   *  is-active class 切替に使う。 */
  modeButtons: Record<string, HTMLButtonElement>;
}

export interface ToolbarController {
  setMode(m: Mode): void;
  attach(): void;
  detach(): void;
}

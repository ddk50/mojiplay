// ToolbarController の public 契約。
//
// Impl は ./toolbar-controller.ts の ToolbarControllerImpl。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActions } from '../menu-action-registry';

export interface ToolbarControllerDeps {
  state: State;
  tools: Record<Mode, Tool>;
  selectCharTool: SelectCharTool;
  menuActions: MenuActions;
  /** buildToolbar が生成した mode → button マップ。is-active class 切替に使う。 */
  modeButtons: Record<string, HTMLButtonElement>;
}

export interface ToolbarController {
  onFontFamilyChange(): void;
  onFontStyleChange(): void;
  onFontSizeChange(): void;
  onFontColorChange(): void;
  onApplyRotation(): void;
  onSelectAllClick(): void;
  onClearClick(): void;
  onExportClick(): void;
  onOutlineClick(): void;
  onSnapConfigChange(): void;
  setMode(m: Mode): void;
  attach(): void;
  detach(): void;
}

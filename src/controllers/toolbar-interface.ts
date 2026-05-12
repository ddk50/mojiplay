// ToolbarController の public 契約。
//
// Impl は ./toolbar-controller.ts の ToolbarControllerImpl。

import type { State, Mode } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { HostShell } from '../usecases/host-shell-interface';
import type { MenuActionRegistry } from '../usecases/menu/menu-action-registry-interface';

export interface ToolbarControllerDeps {
  state: State;
  tools: Record<Mode, Tool>;
  selectCharTool: SelectCharTool;
  host: HostShell;
  menuActions: MenuActionRegistry;
  canvas: fabric.Canvas;
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
  onExportClick(): Promise<void>;
  onOutlineClick(): void;
  onSnapEnabledChange(): void;
  onSnapPitchChange(): void;
  onSnapThresholdChange(): void;
  setMode(m: Mode): void;
  attach(): void;
  detach(): void;
}

// SidebarController の public 契約。
//
// Sidebar = 右パネル (フォント / 変形 / スナップ / アクション / エクスポート)。
// 画面下中央のツール選択は ToolbarController の担当。
//
// Impl は ./sidebar.ts の SidebarControllerImpl。

import type { State } from '../core/state-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActions } from '../menu-action-registry';

export interface SidebarControllerDeps {
  state: State;
  selectCharTool: SelectCharTool;
  menuActions: MenuActions;
}

export interface SidebarController {
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
  attach(): void;
  detach(): void;
}

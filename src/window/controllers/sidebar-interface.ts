// SidebarController の public 契約。
//
// Sidebar = 右パネル (フォント / 変形 / スナップ / アクション / エクスポート)。
// 画面下中央のツール選択は ToolbarController の担当。
//
// Impl は ./sidebar.ts の SidebarControllerImpl。

import type { State } from '../core/state-interface';
import type { FontCatalog } from '../core/font-catalog';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActions } from '../menu-action-registry';
import type { SidebarElements } from '../presenter/sidebar-elements-interface';

export interface SidebarControllerDeps {
  state: State;
  selectCharTool: SelectCharTool;
  menuActions: MenuActions;
  /** mount 時に querySidebarElements で 1 回だけ引いた DOM 要素束。 */
  els: SidebarElements;
  /** font-style select の再構築に使う (family change 時)。 */
  catalog: FontCatalog;
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

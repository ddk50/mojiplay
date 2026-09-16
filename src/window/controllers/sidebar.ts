// SidebarController: 右サイドバー上の入力 (font / size / color / rotation / snap /
// 各種ボタン) を State / MenuAction に dispatch する Input Adapter (外→内)。
//
// 旧 ToolbarController から、担当領域の実体に合わせて改名・分離したもの
// (下部フローティングツールバーではなく右パネルを触っている)。ツール選択
// (mode button) は ToolbarController に残した。
//
// サイドバー入力は HTML メニューバー (= MenuController) よりも property-style な
// 変更が多いので別 Controller として分離している。
//
// 内→外 (選択 → 表示同期) は presenter/sidebar.ts の SidebarPresenter が
// fabric イベントを自分で購読して行う。ここからは蹴らない。

import type { State, SelectionProps } from '../core/state-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActions } from '../menu-action-registry';
import type { SidebarController, SidebarControllerDeps } from './sidebar-interface';
import { fontFamilySel, fontStyleSel, populateStyleList } from '../presenter/font-enumeration';
import { currentFontStyle } from '../presenter/font-current';

export class SidebarControllerImpl implements SidebarController {
  private readonly state: State;
  private readonly selectCharTool: SelectCharTool;
  private readonly menuActions: MenuActions;

  // DOM 参照 (= drawing screen 配下の `drawing-*` prefix 付き ID)
  private readonly fontSizeInput = document.getElementById('drawing-font-size') as HTMLInputElement;
  private readonly fontColorInput = document.getElementById(
    'drawing-font-color',
  ) as HTMLInputElement;
  private readonly rotationInput = document.getElementById('drawing-rotation') as HTMLInputElement;
  private readonly snapEnabledInput = document.getElementById(
    'drawing-snap-enabled',
  ) as HTMLInputElement;
  private readonly snapPitchInput = document.getElementById(
    'drawing-snap-pitch',
  ) as HTMLInputElement;
  private readonly snapThresholdInput = document.getElementById(
    'drawing-snap-threshold',
  ) as HTMLInputElement;
  private readonly btnApplyRotation = document.getElementById(
    'drawing-btn-apply-rotation',
  ) as HTMLButtonElement;
  private readonly btnSelectAll = document.getElementById(
    'drawing-btn-select-all',
  ) as HTMLButtonElement;
  private readonly btnClear = document.getElementById('drawing-btn-clear') as HTMLButtonElement;
  private readonly btnExport = document.getElementById('drawing-btn-export') as HTMLButtonElement;
  private readonly btnOutline = document.getElementById('drawing-btn-outline') as HTMLButtonElement;

  constructor(deps: SidebarControllerDeps) {
    this.state = deps.state;
    this.selectCharTool = deps.selectCharTool;
    this.menuActions = deps.menuActions;

    this.syncSnapConfigToTool();
  }

  // ====================================================================
  //  Public event handlers (= Controller の contract)
  // ====================================================================

  // ── font props ──────────────────────────────────────────────────────────

  /** font-family select の change。populateStyleList も呼んでスタイル一覧を更新。 */
  readonly onFontFamilyChange = (): void => {
    populateStyleList(fontFamilySel.value);
    const props: SelectionProps = {
      fontFamily: fontFamilySel.value,
      ...currentFontStyle(),
    };
    this.state.applyPropsToSelection(props);
  };

  /** font-style select の change (= weight | italic 統合 select)。 */
  readonly onFontStyleChange = (): void => {
    this.state.applyPropsToSelection(currentFontStyle());
  };

  /** font-size input の change。 */
  readonly onFontSizeChange = (): void => {
    this.state.applyPropsToSelection({
      fontSize: parseInt(this.fontSizeInput.value, 10) || 72,
    });
  };

  /** font-color input の input。 */
  readonly onFontColorChange = (): void => {
    this.state.applyPropsToSelection({ fill: this.fontColorInput.value });
  };

  /** btn-apply-rotation click。 */
  readonly onApplyRotation = (): void => {
    const angle = parseFloat(this.rotationInput.value) || 0;
    this.state.applyPropsToSelection({ angle });
  };

  // ── ボタン ───────────────────────────────────────────────────────────

  /** btn-select-all click。 */
  readonly onSelectAllClick = (): void => {
    void this.menuActions['select-all']();
  };

  /** btn-clear click。 */
  readonly onClearClick = (): void => {
    void this.menuActions['clear-all']();
  };

  /** btn-export click。 */
  readonly onExportClick = (): void => {
    void this.menuActions['export-canvas-png']();
  };

  /** btn-outline click。 */
  readonly onOutlineClick = (): void => {
    void this.menuActions.outline();
  };

  // ── snap config ─────────────────────────────────────────────────────

  /** snap 関連 input (enabled/pitch/threshold) の change。
   *  どれが変わっても DOM 全部読み直して tool に push する (= 状態を controller に
   *  持たない、DOM が source of truth)。 */
  readonly onSnapConfigChange = (): void => {
    this.syncSnapConfigToTool();
  };

  // ====================================================================
  //  Lifecycle (self-wiring convenience)
  // ====================================================================

  attach(): void {
    fontFamilySel.addEventListener('change', this.onFontFamilyChange);
    fontStyleSel.addEventListener('change', this.onFontStyleChange);
    this.fontSizeInput.addEventListener('change', this.onFontSizeChange);
    this.fontColorInput.addEventListener('input', this.onFontColorChange);
    this.btnApplyRotation.addEventListener('click', this.onApplyRotation);
    this.btnSelectAll.addEventListener('click', this.onSelectAllClick);
    this.btnClear.addEventListener('click', this.onClearClick);
    this.btnExport.addEventListener('click', this.onExportClick);
    this.btnOutline.addEventListener('click', this.onOutlineClick);
    this.snapEnabledInput.addEventListener('change', this.onSnapConfigChange);
    this.snapPitchInput.addEventListener('input', this.onSnapConfigChange);
    this.snapThresholdInput.addEventListener('input', this.onSnapConfigChange);
  }

  detach(): void {
    fontFamilySel.removeEventListener('change', this.onFontFamilyChange);
    fontStyleSel.removeEventListener('change', this.onFontStyleChange);
    this.fontSizeInput.removeEventListener('change', this.onFontSizeChange);
    this.fontColorInput.removeEventListener('input', this.onFontColorChange);
    this.btnApplyRotation.removeEventListener('click', this.onApplyRotation);
    this.btnSelectAll.removeEventListener('click', this.onSelectAllClick);
    this.btnClear.removeEventListener('click', this.onClearClick);
    this.btnExport.removeEventListener('click', this.onExportClick);
    this.btnOutline.removeEventListener('click', this.onOutlineClick);
    this.snapEnabledInput.removeEventListener('change', this.onSnapConfigChange);
    this.snapPitchInput.removeEventListener('input', this.onSnapConfigChange);
    this.snapThresholdInput.removeEventListener('input', this.onSnapConfigChange);
  }

  // ====================================================================
  //  内部 helper
  // ====================================================================

  private syncSnapConfigToTool(): void {
    this.selectCharTool.setSnapConfig({
      enabled: this.snapEnabledInput.checked,
      pitch: Math.max(1, parseInt(this.snapPitchInput.value, 10) || 8),
      threshold: Math.max(1, parseInt(this.snapThresholdInput.value, 10) || 5),
    });
  }
}

// ToolbarController: ツールバー上の入力 (font / size / color / rotation / snap /
// 各種ボタン) を State / MenuAction / HostShell に dispatch する Input Adapter。
//
// 厳密には UI 上の入力 widget を一手に引き受ける Controller。ツールバー入力は
// HTML メニューバー (= MenuController) よりも property-style な変更が多いので
// 別 Controller として分離。
//
// ツールモード切替 (mode buttons) も含めるが、buildToolbar が button マップを
// 動的生成するため、buildToolbar 呼び出しと初期 mode 設定は app.ts (DI 容器)
// で行い、setMode の実装本体だけここに置く。ToolbarController は modeButtons map
// と現在モードの追従責務 (is-active class 切替) を負う。

import type { State, Mode, SelectionProps } from '../core/state-interface';
import type { Tool } from '../usecases/tools/tool-interface';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActionRegistry } from '../usecases/menu/menu-action-registry-interface';
import type { ToolbarController, ToolbarControllerDeps } from './toolbar-interface';
import { switchMode } from '../usecases/menu/switch-mode';
import { fontFamilySel, fontStyleSel, populateStyleList } from '../renderer/font-enumeration';
import { currentFontStyle } from '../renderer/font-current';

export class ToolbarControllerImpl implements ToolbarController {
  private readonly state: State;
  private readonly tools: Record<Mode, Tool>;
  private readonly selectCharTool: SelectCharTool;
  private readonly menuActions: MenuActionRegistry;
  private readonly modeButtons: Record<string, HTMLButtonElement>;

  // DOM 参照
  private readonly fontSizeInput = document.getElementById('font-size') as HTMLInputElement;
  private readonly fontColorInput = document.getElementById('font-color') as HTMLInputElement;
  private readonly rotationInput = document.getElementById('rotation') as HTMLInputElement;
  private readonly snapEnabledInput = document.getElementById('snap-enabled') as HTMLInputElement;
  private readonly snapPitchInput = document.getElementById('snap-pitch') as HTMLInputElement;
  private readonly snapThresholdInput = document.getElementById(
    'snap-threshold',
  ) as HTMLInputElement;
  private readonly btnApplyRotation = document.getElementById(
    'btn-apply-rotation',
  ) as HTMLButtonElement;
  private readonly btnSelectAll = document.getElementById('btn-select-all') as HTMLButtonElement;
  private readonly btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
  private readonly btnExport = document.getElementById('btn-export') as HTMLButtonElement;
  private readonly btnOutline = document.getElementById('btn-outline') as HTMLButtonElement;

  constructor(deps: ToolbarControllerDeps) {
    this.state = deps.state;
    this.tools = deps.tools;
    this.selectCharTool = deps.selectCharTool;
    this.menuActions = deps.menuActions;
    this.modeButtons = deps.modeButtons;

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
    void this.menuActions.execute('select-all');
  };

  /** btn-clear click。確認 dialog → state.clearAll()。 */
  readonly onClearClick = (): void => {
    if (confirm('キャンバスの内容をすべて削除しますか？')) {
      this.state.clearAll();
    }
  };

  /** btn-export click。 */
  readonly onExportClick = (): void => {
    void this.menuActions.execute('export-canvas-png');
  };

  /** btn-outline click。 */
  readonly onOutlineClick = (): void => {
    void this.menuActions.execute('outline');
  };

  // ── snap config ─────────────────────────────────────────────────────

  /** snap 関連 input (enabled/pitch/threshold) の change。
   *  どれが変わっても DOM 全部読み直して tool に push する (= 状態を controller に
   *  持たない、DOM が source of truth)。 */
  readonly onSnapConfigChange = (): void => {
    this.syncSnapConfigToTool();
  };

  // ── mode 切替 ────────────────────────────────────────────────────────

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

    for (const id of Object.keys(this.modeButtons)) {
      this.modeButtons[id].addEventListener('click', () => this.setMode(id as Mode));
    }
    this.setMode(this.state.getCurrentMode());
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
    // mode button listeners は無名 closure なので detach 不要 (window.unload で破棄)。
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

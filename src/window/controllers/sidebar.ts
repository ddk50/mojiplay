// SidebarController: 右サイドバー上の入力 (font / size / color / rotation / snap /
// 各種ボタン) を State / MenuAction に dispatch する Input Adapter (外→内)。
//
// サイドバー入力は HTML メニューバー (= MenuController) よりも property-style な
// 変更が多いので別 Controller として分離している。
//
// 内→外 (選択 → 表示同期) は presenter/sidebar.ts の SidebarPresenter が
// fabric イベントを自分で購読して行う。ここからは蹴らない。
//
// DOM は SidebarElements を constructor で受け取る (自前の getElementById は持たない)。

import type { State, SelectionProps } from '../core/state-interface';
import type { FontCatalog } from '../core/font-catalog';
import type { SelectCharTool } from '../usecases/tools/select-char-tool';
import type { MenuActions } from '../menu-action-registry';
import type { SidebarController, SidebarControllerDeps } from './sidebar-interface';
import type { SidebarElements } from '../presenter/sidebar-elements-interface';
import { populateStyleList } from '../presenter/sidebar-font-list';
import { currentFontStyle } from '../presenter/font-current';

export class SidebarControllerImpl implements SidebarController {
  private readonly state: State;
  private readonly selectCharTool: SelectCharTool;
  private readonly menuActions: MenuActions;
  private readonly els: SidebarElements;
  private readonly catalog: FontCatalog;

  constructor(deps: SidebarControllerDeps) {
    this.state = deps.state;
    this.selectCharTool = deps.selectCharTool;
    this.menuActions = deps.menuActions;
    this.els = deps.els;
    this.catalog = deps.catalog;

    this.syncSnapConfigToTool();
  }

  // ====================================================================
  //  Public event handlers (= Controller の contract)
  // ====================================================================

  // ── font props ──────────────────────────────────────────────────────────

  /** font-family select の change。
   *  style 一覧を先に作り直してから読む (順序必須: 逆だと前 family の style が残る)。 */
  readonly onFontFamilyChange = (): void => {
    const family = this.els.font.family.value;
    populateStyleList(this.els, this.catalog, family);
    const props: SelectionProps = {
      fontFamily: family,
      ...currentFontStyle(this.els),
    };
    this.state.applyPropsToSelection(props);
  };

  /** font-style select の change (= weight | italic 統合 select)。 */
  readonly onFontStyleChange = (): void => {
    this.state.applyPropsToSelection(currentFontStyle(this.els));
  };

  /** font-size input の change。 */
  readonly onFontSizeChange = (): void => {
    this.state.applyPropsToSelection({
      fontSize: parseInt(this.els.font.size.value, 10) || 72,
    });
  };

  /** font-color input の input。 */
  readonly onFontColorChange = (): void => {
    this.state.applyPropsToSelection({ fill: this.els.font.color.value });
  };

  /** 変形→回転の適用ボタン click。 */
  readonly onApplyRotation = (): void => {
    const angle = parseFloat(this.els.transform.rotation.value) || 0;
    this.state.applyPropsToSelection({ angle });
  };

  // ── ボタン ───────────────────────────────────────────────────────────

  /** アクション→全選択 click。 */
  readonly onSelectAllClick = (): void => {
    void this.menuActions['select-all']();
  };

  /** アクション→クリア click。 */
  readonly onClearClick = (): void => {
    void this.menuActions['clear-all']();
  };

  /** エクスポート→PNG書き出し click。 */
  readonly onExportClick = (): void => {
    void this.menuActions['export-canvas-png']();
  };

  /** アクション→アウトライン化 click。 */
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
    const { font, transform, snap, actions, export: exp } = this.els;
    font.family.addEventListener('change', this.onFontFamilyChange);
    font.style.addEventListener('change', this.onFontStyleChange);
    font.size.addEventListener('change', this.onFontSizeChange);
    font.color.addEventListener('input', this.onFontColorChange);
    transform.apply.addEventListener('click', this.onApplyRotation);
    actions.selectAll.addEventListener('click', this.onSelectAllClick);
    actions.clear.addEventListener('click', this.onClearClick);
    actions.outline.addEventListener('click', this.onOutlineClick);
    exp.png.addEventListener('click', this.onExportClick);
    snap.enabled.addEventListener('change', this.onSnapConfigChange);
    snap.pitch.addEventListener('input', this.onSnapConfigChange);
    snap.threshold.addEventListener('input', this.onSnapConfigChange);
  }

  detach(): void {
    const { font, transform, snap, actions, export: exp } = this.els;
    font.family.removeEventListener('change', this.onFontFamilyChange);
    font.style.removeEventListener('change', this.onFontStyleChange);
    font.size.removeEventListener('change', this.onFontSizeChange);
    font.color.removeEventListener('input', this.onFontColorChange);
    transform.apply.removeEventListener('click', this.onApplyRotation);
    actions.selectAll.removeEventListener('click', this.onSelectAllClick);
    actions.clear.removeEventListener('click', this.onClearClick);
    actions.outline.removeEventListener('click', this.onOutlineClick);
    exp.png.removeEventListener('click', this.onExportClick);
    snap.enabled.removeEventListener('change', this.onSnapConfigChange);
    snap.pitch.removeEventListener('input', this.onSnapConfigChange);
    snap.threshold.removeEventListener('input', this.onSnapConfigChange);
  }

  // ====================================================================
  //  内部 helper
  // ====================================================================

  private syncSnapConfigToTool(): void {
    const { snap } = this.els;
    this.selectCharTool.setSnapConfig({
      enabled: snap.enabled.checked,
      pitch: Math.max(1, parseInt(snap.pitch.value, 10) || 8),
      threshold: Math.max(1, parseInt(snap.threshold.value, 10) || 5),
    });
  }
}

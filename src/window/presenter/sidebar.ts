// SidebarPresenter: 右サイドバー (= #drawing-sidebar) の内→外 (選択 → 表示同期)。
//
// fabric の selection:created/updated/cleared と object:rotating を **自分で購読**
// して、選択中 object の props をサイドバーへ反映 + フォント系 disable 判定を行う。
// 内→外の表示同期は Presenter の責務なので、Controller 経由で蹴ってもらうのでは
// なく self-wiring する (attach/detach は Controller と同じ流儀)。
//
// DOM は SidebarElements を、フォント一覧は FontCatalog を constructor で受け取る
// (import 時副作用なし / getElementById はここでは呼ばない)。

import type { FontCatalog } from '../core/font-catalog';
import { styleValue } from '../core/font-catalog';
import type { SidebarElements } from './sidebar-elements-interface';
import { populateStyleList } from './sidebar-font-list';
import { shouldDisableFontControls, type FontEditableProbe } from './font-editable';

export interface SidebarPresenterDeps {
  canvas: fabric.Canvas;
  els: SidebarElements;
  catalog: FontCatalog;
}

export class SidebarPresenter {
  private readonly canvas: fabric.Canvas;
  private readonly els: SidebarElements;
  private readonly catalog: FontCatalog;

  constructor(deps: SidebarPresenterDeps) {
    this.canvas = deps.canvas;
    this.els = deps.els;
    this.catalog = deps.catalog;
  }

  // ====================================================================
  //  Lifecycle (self-wiring)
  // ====================================================================

  attach(): void {
    this.canvas.on('selection:created', this.onSelectionEvent);
    this.canvas.on('selection:updated', this.onSelectionEvent);
    this.canvas.on('selection:cleared', this.onSelectionEvent);
    this.canvas.on('object:rotating', this.onObjectRotating);
  }

  detach(): void {
    this.canvas.off('selection:created', this.onSelectionEvent as never);
    this.canvas.off('selection:updated', this.onSelectionEvent as never);
    this.canvas.off('selection:cleared', this.onSelectionEvent as never);
    this.canvas.off('object:rotating', this.onObjectRotating as never);
  }

  // ====================================================================
  //  fabric event handlers (内→外の表示同期。冪等: 現在の選択を読むだけ)
  // ====================================================================

  private readonly onSelectionEvent = (): void => {
    this.syncToSelection();
  };

  private readonly onObjectRotating = (e: fabric.IEvent): void => {
    if (e.target) this.els.transform.rotation.value = String(Math.round(e.target.angle ?? 0));
  };

  /** 選択中 object の props をサイドバーへ反映し、フォント変更が効かない選択では
   *  フォント系コントロールを disable にする。選択なし (cleared) は enable 復帰。 */
  private syncToSelection(): void {
    const { font, transform } = this.els;

    // outlined path のみの選択ではフォント変更が効かない (サイレント no-op) ので
    // family / style / size を disable。activeSelection / 選択なし経路も含めて
    // ここで一括更新するため、下の早期 return より前に置く。
    const fontDisabled = shouldDisableFontControls(
      this.canvas.getActiveObjects() as unknown as ReadonlyArray<FontEditableProbe>,
    );
    font.family.disabled = fontDisabled;
    font.style.disabled = fontDisabled;
    font.size.disabled = fontDisabled;

    const active = this.canvas.getActiveObject() as (fabric.Object & Partial<fabric.Text>) | null;
    if (!active || active.type === 'activeSelection') return;
    if (active.fontFamily) {
      if (font.family.value !== active.fontFamily) {
        font.family.value = active.fontFamily;
        populateStyleList(this.els, this.catalog, active.fontFamily);
      }
      const rawWeight = active.fontWeight;
      const weight =
        typeof rawWeight === 'number'
          ? rawWeight
          : String(rawWeight).toLowerCase() === 'bold'
            ? 700
            : 400;
      const italic = active.fontStyle === 'italic';
      font.style.value = styleValue(weight, italic);
    }
    if (active.fontSize) font.size.value = String(active.fontSize);
    if (active.fill) font.color.value = active.fill as string;
    transform.rotation.value = String(Math.round(active.angle ?? 0));
  }
}

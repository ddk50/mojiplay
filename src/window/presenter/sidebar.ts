// SidebarPresenter: 右サイドバー (= #drawing-sidebar) の内→外 (選択 → 表示同期)。
//
// 旧 ToolbarPresenter.syncToSelection を、担当領域の実体に合わせて改名・分離した
// もの (下部フローティングツールバーではなく右パネルを触っている)。
//
// fabric の selection:created/updated/cleared と object:rotating を **自分で購読**
// して、選択中 object の props をサイドバーへ反映 + フォント系 disable 判定を行う。
// 内→外の表示同期は Presenter の責務なので、Controller 経由で蹴ってもらうのでは
// なく self-wiring する (attach/detach は Controller と同じ流儀)。
//
// canvas / DOM 参照は constructor で受け取り・取得する (import 時副作用なし)。
// fontFamilySel / fontStyleSel は font-enumeration.ts の module-level export を
// 引き続き参照 (将来ここへ吸収する候補)。

import { fontFamilySel, fontStyleSel, populateStyleList, styleValue } from './font-enumeration';
import { shouldDisableFontControls, type FontEditableProbe } from './font-editable';

export class SidebarPresenter {
  private readonly canvas: fabric.Canvas;
  private readonly fontSizeInput: HTMLInputElement;
  private readonly fontColorInput: HTMLInputElement;
  private readonly rotationInput: HTMLInputElement;

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
    this.fontSizeInput = document.getElementById('drawing-font-size') as HTMLInputElement;
    this.fontColorInput = document.getElementById('drawing-font-color') as HTMLInputElement;
    this.rotationInput = document.getElementById('drawing-rotation') as HTMLInputElement;
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
    if (e.target) this.rotationInput.value = String(Math.round(e.target.angle ?? 0));
  };

  /** 選択中 object の props をサイドバーへ反映し、フォント変更が効かない選択では
   *  フォント系コントロールを disable にする。選択なし (cleared) は enable 復帰。 */
  private syncToSelection(): void {
    // outlined path のみの選択ではフォント変更が効かない (サイレント no-op) ので
    // family / style / size を disable。activeSelection / 選択なし経路も含めて
    // ここで一括更新するため、下の早期 return より前に置く。
    const fontDisabled = shouldDisableFontControls(
      this.canvas.getActiveObjects() as unknown as ReadonlyArray<FontEditableProbe>,
    );
    fontFamilySel.disabled = fontDisabled;
    fontStyleSel.disabled = fontDisabled;
    this.fontSizeInput.disabled = fontDisabled;

    const active = this.canvas.getActiveObject() as (fabric.Object & Partial<fabric.Text>) | null;
    if (!active || active.type === 'activeSelection') return;
    if (active.fontFamily) {
      if (fontFamilySel.value !== active.fontFamily) {
        fontFamilySel.value = active.fontFamily;
        populateStyleList(active.fontFamily);
      }
      const rawWeight = active.fontWeight;
      const weight =
        typeof rawWeight === 'number'
          ? rawWeight
          : String(rawWeight).toLowerCase() === 'bold'
            ? 700
            : 400;
      const italic = active.fontStyle === 'italic';
      fontStyleSel.value = styleValue(weight, italic);
    }
    if (active.fontSize) this.fontSizeInput.value = String(active.fontSize);
    if (active.fill) this.fontColorInput.value = active.fill as string;
    this.rotationInput.value = String(Math.round(active.angle ?? 0));
  }
}

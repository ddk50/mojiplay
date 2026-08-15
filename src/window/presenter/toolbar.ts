// ToolbarPresenter。toolbar の挙動に責任を持つコードをここに集約する:
//
//   - buildModeButtons: mode 切替ボタン群を tools 配列から動的生成。
//     各 Tool が descriptor (id / label / iconSvg) を自己完結で持つので「受け取った
//     文字列を innerHTML に流す pure sink」として動く。icon registry のような中間層
//     は持たない (1 アイコン 1 箇所主義)。構造不変条件 (非空フィールド / id 衝突無し)
//     は起動時に fail-fast で弾く。
//   - 選択→表示同期: fabric の selection:created/updated/cleared と object:rotating
//     を **自分で購読** して、選択中 object の props をツールバーへ反映 + フォント系
//     disable 判定。内→外の表示同期は Presenter の責務なので、Controller 経由で
//     蹴ってもらうのではなく self-wiring する (attach/detach は Controller と同じ流儀)。
//
// canvas / DOM 参照は constructor で受け取り・取得する (import 時副作用なし)。
// fontFamilySel / fontStyleSel は font-enumeration.ts の module-level export を
// 引き続き参照 (将来ここへ吸収する候補)。

import type { Tool } from '../usecases/tools/tool-interface';
import { fontFamilySel, fontStyleSel, populateStyleList, styleValue } from './font-enumeration';
import { shouldDisableFontControls, type FontEditableProbe } from './font-editable';

function assertValidDescriptors(tools: ReadonlyArray<Tool>): void {
  const seen = new Set<string>();
  for (const t of tools) {
    const d = t.descriptor;
    if (!d.id || !d.label || !d.iconSvg) {
      throw new Error(`tool descriptor has empty field(s): ${JSON.stringify(d)}`);
    }
    if (seen.has(d.id)) {
      throw new Error(`duplicate tool descriptor id: ${d.id}`);
    }
    seen.add(d.id);
  }
}

export class ToolbarPresenter {
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

  buildModeButtons(
    tools: ReadonlyArray<Tool>,
    container: HTMLElement,
    onSelect: (id: string) => void,
  ): Record<string, HTMLButtonElement> {
    assertValidDescriptors(tools);

    container.innerHTML = '';
    const map: Record<string, HTMLButtonElement> = {};

    for (const t of tools) {
      const d = t.descriptor;
      const btn = document.createElement('button');
      btn.id = `btn-mode-${d.id}`;
      btn.className = 'mode-btn';
      btn.title = d.label;
      btn.innerHTML = d.iconSvg;
      btn.addEventListener('click', () => onSelect(d.id));
      container.appendChild(btn);
      map[d.id] = btn;
    }

    return map;
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

  /** 選択中 object の props をツールバーへ反映し、フォント変更が効かない選択では
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

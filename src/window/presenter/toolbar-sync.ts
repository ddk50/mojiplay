// Toolbar (font / size / color / rotation) を選択中 object に同期する Presenter。
//
// fabric の selection:created / selection:updated / object:rotating で発火する。
// もとは app.ts:syncToolbarToSelection だったロジックを抽出。

import { fontFamilySel, fontStyleSel, populateStyleList, styleValue } from './font-enumeration';
import { shouldDisableFontControls, type FontEditableProbe } from './font-editable';

const fontSizeInput = document.getElementById('drawing-font-size') as HTMLInputElement;
const fontColorInput = document.getElementById('drawing-font-color') as HTMLInputElement;
const rotationInput = document.getElementById('drawing-rotation') as HTMLInputElement;

export function syncToolbarToSelection(canvas: fabric.Canvas): void {
  // outlined path のみの選択ではフォント変更が効かない (サイレント no-op) ので
  // family / style / size を disable。activeSelection / 選択なし経路も含めて
  // ここで一括更新するため、下の早期 return より前に置く。
  const fontDisabled = shouldDisableFontControls(
    canvas.getActiveObjects() as unknown as ReadonlyArray<FontEditableProbe>,
  );
  fontFamilySel.disabled = fontDisabled;
  fontStyleSel.disabled = fontDisabled;
  fontSizeInput.disabled = fontDisabled;

  const active = canvas.getActiveObject() as (fabric.Object & Partial<fabric.Text>) | null;
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
  if (active.fontSize) fontSizeInput.value = String(active.fontSize);
  if (active.fill) fontColorInput.value = active.fill as string;
  rotationInput.value = String(Math.round(active.angle ?? 0));
}

/** object:rotating で rotation インプットを追従させる。 */
export function setRotationInput(angle: number): void {
  rotationInput.value = String(Math.round(angle));
}

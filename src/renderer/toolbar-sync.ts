// Toolbar (font / size / color / rotation) を選択中 object に同期する Presenter。
//
// fabric の selection:created / selection:updated / object:rotating で発火する。
// もとは app.ts:syncToolbarToSelection だったロジックを抽出。

import {
  fontFamilySel, fontStyleSel, populateStyleList, styleValue,
} from './font-enumeration';

const fontSizeInput  = document.getElementById('font-size')  as HTMLInputElement;
const fontColorInput = document.getElementById('font-color') as HTMLInputElement;
const rotationInput  = document.getElementById('rotation')   as HTMLInputElement;

export function syncToolbarToSelection(canvas: fabric.Canvas): void {
  const active = canvas.getActiveObject() as any;
  if (!active || active.type === 'activeSelection') return;
  if (active.fontFamily) {
    if (fontFamilySel.value !== active.fontFamily) {
      fontFamilySel.value = active.fontFamily;
      populateStyleList(active.fontFamily);
    }
    const rawWeight = active.fontWeight;
    const weight = typeof rawWeight === 'number'
      ? rawWeight
      : (String(rawWeight).toLowerCase() === 'bold' ? 700 : 400);
    const italic = active.fontStyle === 'italic';
    fontStyleSel.value = styleValue(weight, italic);
  }
  if (active.fontSize)  fontSizeInput.value  = String(active.fontSize);
  if (active.fill)      fontColorInput.value = active.fill as string;
  rotationInput.value = String(Math.round(active.angle ?? 0));
}

/** object:rotating で rotation インプットを追従させる。 */
export function setRotationInput(angle: number): void {
  rotationInput.value = String(Math.round(angle));
}

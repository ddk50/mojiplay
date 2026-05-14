// 現在の toolbar 入力 (font / weight / italic / size / color) から TextCreateProps /
// SelectionProps を組み立てるヘルパ。
//
// TextTool (新規 IText 生成) と ToolbarController (toolbar 変更時の applyToSelection)
// の両方で同じ DOM source を使うため、ここに 1 か所集約する。

import type { TextCreateProps } from '../core/state-interface';
import { fontFamilySel, fontStyleSel } from './font-enumeration';

const fontSizeInput = document.getElementById('font-size') as HTMLInputElement;
const fontColorInput = document.getElementById('font-color') as HTMLInputElement;

export function currentFontStyle(): { fontWeight: number; fontStyle: 'normal' | 'italic' } {
  const [weightStr, italicStr] = fontStyleSel.value.split('|');
  const fontWeight = parseInt(weightStr, 10) || 400;
  const fontStyle = italicStr === 'italic' ? 'italic' : 'normal';
  return { fontWeight, fontStyle };
}

export function currentTextProps(): TextCreateProps {
  const { fontWeight, fontStyle } = currentFontStyle();
  return {
    fontFamily: fontFamilySel.value,
    fontSize: parseInt(fontSizeInput.value, 10) || 72,
    fontWeight,
    fontStyle,
    fill: fontColorInput.value,
  };
}

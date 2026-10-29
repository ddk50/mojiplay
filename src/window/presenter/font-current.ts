// 現在のサイドバー入力 (font / weight / italic / size / color) から TextCreateProps /
// SelectionProps を組み立てるヘルパ。
//
// TextTool (新規 IText 生成) と SidebarController (サイドバー変更時の
// applyToSelection) の両方で同じ DOM source を使うため、ここに 1 か所集約する。
//
// DOM は module-level では触らず SidebarElements を引数で受け取る (import 時副作用なし)。

import type { TextCreateProps } from '../core/state-interface';
import type { SidebarElements } from './sidebar-elements-interface';

export function currentFontStyle(els: SidebarElements): {
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
} {
  const [weightStr, italicStr] = els.font.style.value.split('|');
  const fontWeight = parseInt(weightStr, 10) || 400;
  const fontStyle = italicStr === 'italic' ? 'italic' : 'normal';
  return { fontWeight, fontStyle };
}

export function currentTextProps(els: SidebarElements): TextCreateProps {
  const { fontWeight, fontStyle } = currentFontStyle(els);
  return {
    fontFamily: els.font.family.value,
    fontSize: parseInt(els.font.size.value, 10) || 72,
    fontWeight,
    fontStyle,
    fill: els.font.color.value,
  };
}

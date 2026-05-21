// システムフォント列挙 (Local Font Access API)
//
// Electron 29 / Chromium 122+ に標準搭載。main 側で local-fonts 権限を許可済み。
// 取得失敗時は index.html のフォールバック Arial / Regular がそのまま残る。

import { logger } from './logger';

export type StyleInfo = { label: string; weight: number; italic: boolean };

const WEIGHT_MAP: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  '': 400,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

export function parseStyle(s: string): StyleInfo {
  const lower = s.toLowerCase();
  const italic = /italic|oblique/.test(lower);
  const key = lower.replace(/italic|oblique/g, '').replace(/\s+/g, '');
  const weight = WEIGHT_MAP[key] ?? 400;
  return { label: s || 'Regular', weight, italic };
}

export const fontsByFamily = new Map<string, StyleInfo[]>();

export const fontFamilySel = document.getElementById('drawing-font-family') as HTMLSelectElement;
export const fontStyleSel = document.getElementById('drawing-font-style') as HTMLSelectElement;

export function styleValue(weight: number, italic: boolean): string {
  return `${weight}|${italic ? 'italic' : 'normal'}`;
}

export function populateStyleList(family: string): void {
  const styles = fontsByFamily.get(family);
  const previous = fontStyleSel.value;
  fontStyleSel.innerHTML = '';

  const list: StyleInfo[] =
    styles && styles.length > 0 ? styles : [{ label: 'Regular', weight: 400, italic: false }];

  for (const s of list) {
    const opt = document.createElement('option');
    opt.value = styleValue(s.weight, s.italic);
    opt.textContent = s.label;
    fontStyleSel.appendChild(opt);
  }

  const values = list.map((s) => styleValue(s.weight, s.italic));
  if (values.includes(previous)) {
    fontStyleSel.value = previous;
  } else {
    const regular = styleValue(400, false);
    fontStyleSel.value = values.includes(regular) ? regular : values[0];
  }
}

export async function populateFontList(): Promise<void> {
  if (typeof window.queryLocalFonts !== 'function') return;
  try {
    const fonts = await window.queryLocalFonts();
    if (!fonts.length) return;

    fontsByFamily.clear();
    for (const f of fonts) {
      const info = parseStyle(f.style);
      let arr = fontsByFamily.get(f.family);
      if (!arr) {
        arr = [];
        fontsByFamily.set(f.family, arr);
      }
      if (!arr.some((x) => x.weight === info.weight && x.italic === info.italic)) {
        arr.push(info);
      }
    }
    for (const arr of fontsByFamily.values()) {
      arr.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
    }

    const families = Array.from(fontsByFamily.keys()).sort((a, b) => a.localeCompare(b, 'ja'));

    const previous = fontFamilySel.value;
    fontFamilySel.innerHTML = '';
    for (const family of families) {
      const opt = document.createElement('option');
      opt.value = family;
      opt.textContent = family;
      fontFamilySel.appendChild(opt);
    }
    fontFamilySel.value = families.includes(previous) ? previous : families[0];
    populateStyleList(fontFamilySel.value);
  } catch (err) {
    logger.error('[fonts] queryLocalFonts failed', err);
  }
}

populateFontList();

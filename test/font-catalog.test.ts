// FontCatalog / parseStyle / styleValue の unit test。
//
// 旧 presenter/font-enumeration.ts は module-level で getElementById と
// populateFontList() を呼んでいたため testEnvironment: 'node' では import すら
// できなかった。pure module (core/font-catalog.ts) に抽出したことで、DOM も
// Local Font Access API も無しで直接検証できる。

import {
  parseStyle,
  styleValue,
  FontCatalog,
  DEFAULT_STYLE,
  type FontEntry,
} from '../src/window/core/font-catalog';

describe('parseStyle', () => {
  it('既知の weight 名を数値に正規化する', () => {
    expect(parseStyle('Bold')).toEqual({ label: 'Bold', weight: 700, italic: false });
    expect(parseStyle('SemiBold').weight).toBe(600);
    expect(parseStyle('Thin').weight).toBe(100);
    expect(parseStyle('Black').weight).toBe(900);
  });

  it('空白を無視して複合語を解決する ("Extra Light" → extralight)', () => {
    expect(parseStyle('Extra Light').weight).toBe(200);
  });

  it('italic / oblique を検出し、weight 判定からは取り除く', () => {
    expect(parseStyle('Bold Italic')).toEqual({
      label: 'Bold Italic',
      weight: 700,
      italic: true,
    });
    expect(parseStyle('Oblique')).toEqual({ label: 'Oblique', weight: 400, italic: true });
  });

  it('未知の style 名は 400 / roman にフォールバックする', () => {
    expect(parseStyle('Frobnicate')).toEqual({
      label: 'Frobnicate',
      weight: 400,
      italic: false,
    });
  });

  it('空文字は label を Regular に補う', () => {
    expect(parseStyle('')).toEqual({ label: 'Regular', weight: 400, italic: false });
  });
});

describe('styleValue', () => {
  it('select の option value 表現を作る', () => {
    expect(styleValue(400, false)).toBe('400|normal');
    expect(styleValue(700, true)).toBe('700|italic');
  });
});

describe('FontCatalog', () => {
  const entries: ReadonlyArray<FontEntry> = [
    { family: 'Meiryo', style: 'Bold' },
    { family: 'Arial', style: 'Italic' },
    { family: 'Arial', style: 'Regular' },
    { family: 'Arial', style: 'Bold' },
  ];

  it('初期状態は空で、stylesOf は既定スタイルを返す', () => {
    const c = new FontCatalog();
    expect(c.isEmpty()).toBe(true);
    expect(c.families()).toEqual([]);
    expect(c.stylesOf('Arial')).toEqual([DEFAULT_STYLE]);
  });

  it('family を昇順で返す', () => {
    const c = new FontCatalog();
    c.replaceAll(entries);
    expect(c.isEmpty()).toBe(false);
    expect(c.families()).toEqual(['Arial', 'Meiryo']);
  });

  it('style を weight 昇順 → roman 優先でソートする', () => {
    const c = new FontCatalog();
    c.replaceAll(entries);
    expect(c.stylesOf('Arial').map((s) => styleValue(s.weight, s.italic))).toEqual([
      '400|normal',
      '400|italic',
      '700|normal',
    ]);
  });

  it('同じ (weight, italic) の style は 1 つに畳む', () => {
    const c = new FontCatalog();
    c.replaceAll([
      { family: 'Arial', style: 'Regular' },
      { family: 'Arial', style: 'Book' }, // Regular と同じ 400 / roman
      { family: 'Arial', style: 'Normal' },
    ]);
    expect(c.stylesOf('Arial')).toHaveLength(1);
    expect(c.stylesOf('Arial')[0].label).toBe('Regular'); // 先勝ち
  });

  it('未知 family には既定スタイルを返す', () => {
    const c = new FontCatalog();
    c.replaceAll(entries);
    expect(c.stylesOf('NoSuchFont')).toEqual([DEFAULT_STYLE]);
  });

  it('replaceAll は前回の内容を捨てる', () => {
    const c = new FontCatalog();
    c.replaceAll(entries);
    c.replaceAll([{ family: 'Courier', style: 'Regular' }]);
    expect(c.families()).toEqual(['Courier']);
    expect(c.stylesOf('Arial')).toEqual([DEFAULT_STYLE]);
  });
});

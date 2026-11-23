// core/vertical-text の純粋計算 test。

import {
  pivotAboveBaseline,
  placeVerticalChar,
  verticalGlyphTransform,
} from '../src/window/core/vertical-text';

describe('verticalGlyphTransform', () => {
  test('通常の文字は変形なし', () => {
    for (const ch of ['あ', '漢', 'A', '1']) {
      expect(verticalGlyphTransform(ch)).toEqual({ angle: 0, dx: 0, dy: 0 });
    }
  });

  test('長音・括弧・波ダッシュは 90° 回転', () => {
    for (const ch of ['ー', '「', '」', '（', '〜', '…']) {
      expect(verticalGlyphTransform(ch).angle).toBe(90);
    }
  });

  test('句読点は右上へ寄せる (回転なし)', () => {
    const t = verticalGlyphTransform('。');
    expect(t.angle).toBe(0);
    expect(t.dx).toBeGreaterThan(0);
    expect(t.dy).toBeLessThan(0);
  });

  test('小書き仮名は少し右上へ', () => {
    const t = verticalGlyphTransform('ゃ');
    expect(t.angle).toBe(0);
    expect(t.dx).toBeGreaterThan(0);
    expect(t.dy).toBeLessThan(0);
  });
});

describe('placeVerticalChar', () => {
  const cell = { columnLeft: 0, columnWidth: 100, rowTop: 0, fontSize: 100 };

  test('正立文字は列中央揃え、top は行の上端', () => {
    const p = placeVerticalChar({ ...cell, char: 'A', charWidth: 60 });
    expect(p).toEqual({ left: 20, top: 0, angle: 0 });
  });

  test('回転文字は字面中心 (列中央, 行上端 + 0.5em) 周りに回る', () => {
    const p = placeVerticalChar({ ...cell, char: 'ー', charWidth: 100 });
    // fabric (origin left/top) で local (w/2, 0.5em) の点 = (left, top) + R(90°)·(50, 50)
    const cx = p.left - 50;
    const cy = p.top + 50;
    expect(p.angle).toBe(90);
    expect(cx).toBeCloseTo(50);
    expect(cy).toBeCloseTo(50);
  });

  test('pivotAboveBaseline: baseline (上端 + 0.879em) から上端 + 0.5em までの距離', () => {
    expect(pivotAboveBaseline(100)).toBeCloseTo(100 * 1.13 * 0.778 - 50);
  });

  test('句読点は em 単位の寄せが加わる', () => {
    const p = placeVerticalChar({ ...cell, char: '、', charWidth: 100 });
    const t = verticalGlyphTransform('、');
    expect(p.left).toBeCloseTo(t.dx * 100);
    expect(p.top).toBeCloseTo(t.dy * 100);
  });
});
